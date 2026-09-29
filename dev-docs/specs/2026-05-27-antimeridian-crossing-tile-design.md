# Render imagery crossing the antimeridian by cutting tiles in two

- **Date:** 2026-05-27
- **Issues:** [#171](https://github.com/developmentseed/deck.gl-raster/issues/171), [#366](https://github.com/developmentseed/deck.gl-raster/issues/366)
- **Status:** Proposed
- **Prerequisite (merged):** [#517](https://github.com/developmentseed/deck.gl-raster/issues/517) / [#518](https://github.com/developmentseed/deck.gl-raster/pull/518) — multi-world-copy tile traversal
- **Related:** [#182](https://github.com/developmentseed/deck.gl-raster/issues/182), [#351](https://github.com/developmentseed/deck.gl-raster/pull/351) (reprojector sub-domain / cutline), [`dev-docs/coordinate-systems.md`](../coordinate-systems.md), [`dev-docs/world-copies.md`](../world-copies.md)
- **Informed by (not the basis):** [#353](https://github.com/developmentseed/deck.gl-raster/pull/353) (rejected: global proj4 `+over` hack), [#374](https://github.com/developmentseed/deck.gl-raster/pull/374) and [#269](https://github.com/developmentseed/deck.gl-raster/pull/269) (AI-generated unwrap attempts)

## Problem

A single raster whose source extent crosses ±180° longitude does not render correctly in a Web Mercator viewport. This covers:

- A global EPSG:4326 COG whose bounds touch or slightly overhang ±180° (e.g. `[-180.0012, …, 179.9987, …]`), where the dateline-edge tile straddles the seam.
- A genuine crossing scene whose source grid wraps past ±180° (stored with longitudes running e.g. 170° → 190°).

"Antimeridian" decomposes into three problems: **A** — tile *selection* across world copies (#517, fixed in #518); **B** — global-COG mesh divergence (#366); **C** — true crossing imagery (#171). A is merged. This spec addresses **B + C**, which are the same underlying problem at different tile geometries: a tile whose source extent crosses ±180° needs a *continuous* projection to mesh and place correctly.

## Why it's hard

The Web Mercator render path projects each tile through
[`raster-tileset-2d.ts`](../../packages/deck.gl-raster/src/raster-tileset/raster-tileset-2d.ts) `projectPosition`:

```ts
projectPosition = (x, y) => rescaleEPSG3857ToCommonSpace(descriptor.projectTo3857(x, y));
```

`projectTo3857` is proj4 (source CRS → 3857 m). proj4 normalizes longitude to (−180°, 180°], so a tile straddling the dateline has corners at +179° → 3857 x ≈ **+19.9 Mm** (common-x ≈ 510) and +181°/−179° → 3857 x ≈ **−19.9 Mm** (common-x ≈ 2). The `RasterReprojector` (Delatin) mesh triangle spanning those corners covers the whole world, and its pixel-space error never converges (#366: `error=43200` after 10 000 iterations).

**Unwrapping in source-longitude space does not work:** proj4 re-normalizes any longitude you hand it (190° → −170°), re-introducing the jump (dcherian, [#269](https://github.com/developmentseed/deck.gl-raster/pull/269)). Any unwrap must therefore act at/after the transform output — which is what makes the "keep it as one tile" approaches fragile.

## Approach: cut the tile in two

Rather than keep the crossing tile as one mesh and fight proj4 to make its coordinates continuous (the **render-as-one** family: #374 output-space shift, #269 reprojector unwrap, #353 global `+over`), **split the tile at the antimeridian into a west piece and an east piece.** Each piece lies wholly on one side of the dateline, so:

- The west piece is monotonic in 3857 (all +x → common-x up to 512); the east piece all −x → common-x from 0. **The discontinuity exists only *at* the shared seam edge, not within a piece's interior** (see "Seam handling" below).
- Almost no projection change: the west piece uses stock `projectTo3857`; the east piece needs only a trivial one-line seam fix — no proj4 reconfiguration, no `+over`, no phase-unwrap.
- The `RasterReprojector` needs zero antimeridian awareness — Delatin converges normally on each piece.
- Mesh vertices stay within `[0, 512]`, so the fp64 high-zoom precision scheme ([`coordinate-systems.md`](../coordinate-systems.md)) is untouched.
- Each piece is a normal tile that the merged world-copy traversal (#518) selects and draws across copies.

The antimeridian becomes *a tile boundary*, which the pipeline already handles, instead of a coordinate-space discontinuity.

### Seam handling

> **Revised twice since first written — 2026-09-29.** This section has gone through three
> mechanisms as the failure modes of each were found: (1) the original design (struck through
> below) — a wrapped-piece-only sign test; (2) a symmetric per-point midpoint test that fixed (1)'s
> bug but turned out to have its own width limit; (3) the mechanism described first below, which
> fixes (2)'s limit too and is what's actually shipped. See the tests in
> `raster-tileset-2d-antimeridian.test.ts` and `antimeridian-cut.test.ts`, and the traversal fix this
> motivated in "Locating and selecting a crossing tile in the traversal" below.

Splitting at the antimeridian is *almost* enough — but not quite. proj4 normalizes ±180° to the **positive** boundary (+max_X / common-x 512). That's correct for the west piece (its right edge *is* +180°), but the east piece's left edge is also the antimeridian and must sit at common-x 0 (−max_X). With stock proj4 the east piece's seam corner lands at 512 while its interior is near 0, so its seed triangle still spans the world and the reprojector diverges — the original #366 failure.

**As implemented**, the fix corrects each vertex's raw (proj4-wrapped) common-space `x` using a reference computed from *that vertex's own position*, not a single value shared by the whole piece. Every tile that crosses the antimeridian already gets its seam located by `antimeridianCut` ([`antimeridian-cut.ts`](../../packages/deck.gl-raster/src/raster-tileset/antimeridian-cut.ts)), which — via `unwrapEastLng`, the GeoJSON (RFC 7946 §5.2) "west > east marks a crossing" idiom — locates the seam as a fraction `uCut` of the tile's width, and records the tile's total angular width `totalSpanDeg`. `unwrapCommonSpaceX(x, u, cut, tileSize)` reuses exactly that: for a vertex at fractional position `u` along the tile (0 at the west edge, 1 at the east edge — the same domain `uCut` lives in), it computes

```ts
const signedDegreesFromSeam = (u - cut.uCut) * cut.totalSpanDeg;
const expectedX = tileSize + signedDegreesFromSeam * (tileSize / 360);
return x + Math.round((expectedX - x) / tileSize) * tileSize;
```

— an *expected* `x` derived purely from the vertex's own distance from the seam, then snaps the actual wrapped `x` to the representative nearest that expectation. The seam itself (`u = cut.uCut`) always maps to exactly `tileSize`; the west side extends below it, the east side above it — this is the "combined" form the traversal's bounding volume wants directly (one contiguous box around the seam). `buildPieceReprojection` reuses it for the west piece's `forwardReproject` unchanged, and re-anchors the east piece into its own local frame (seam at `0`, not `tileSize`) by subtracting `tileSize`. `inverseReproject` undoes that re-anchor and reduces into the canonical `[0, tileSize)` range (`((x % tileSize) + tileSize) % tileSize`) — this exactly inverts whatever integer multiple of `tileSize` the forward direction applied, without needing to replay the correction logic.

One outcome worth calling out: this gives each piece its own **natural** common-space position (west near `x≈512`, east near `x≈0`) instead of always anchoring both near a single shared frame. That turned out to be load-bearing for the traversal fix below — a piece now needs no help from the other piece (or the seam) being in view to be found and drawn correctly.

#### Why a per-point, position-derived reference — not a fixed one

Two earlier, simpler mechanisms were tried and superseded before landing on the one above; both are worth keeping visible because they're the reasoning that rules out the "obvious" fixes.

**Attempt 1 (original design, struck through below): a wrapped-piece-only sign test.** A single constant-per-piece shift, decided by *which piece* is rendering, is wrong exactly at that piece's own boundary corner — the vertex that coincides with the *other* piece's edge and needs no shift at all. A per-piece constant can't tell "this piece's own interior vertex that happens to be wrapped" apart from "this piece's own boundary vertex that must stay put," because whether a given vertex needs the shift depends on *that vertex's own position*, not on which piece asked.

**Attempt 2: a symmetric per-point midpoint test** (`x < tileSize/2 → +tileSize`, mirrored for east) — fixed attempt 1's bug by testing every vertex rather than trusting the piece label, and shipped for a while. It has a subtler, width-dependent failure: it's a *magnitude* test against a fixed midpoint, and once a piece is wide enough (≳180° of longitude), some of its own legitimately-placed vertices land on the "wrong" side of that midpoint *without having wrapped at all* — the test can't tell "this vertex wrapped around the seam" apart from "this vertex is just far from the seam," because both look identical once reduced to one magnitude comparison against a constant. The result is a silently torn mesh for a wide enough tile.

Reframed generally: **any correction anchored to a single, fixed reference for the whole piece — however that reference is chosen** (a midpoint, a piece-specific corner, a comparison done in longitude space instead of common-space) **— can only disambiguate up to half a period (180°) away from itself.** That's a property of the math (recovering a 360°-periodic signal's true phase from one sample more than half a period from your only reference is not possible), not an implementation gap. Two specific variants were tried and confirmed to hit this wall:

- **Piece-relative fixed reference** (compare each vertex against its own piece's known seam corner, `TILE_SIZE` for west / `0` for east, instead of the bare `tileSize/2` constant) turns out to be *arithmetically identical* to attempt 2 — for this geometry, the only legitimate fixed reference for each piece already *is* `0` or `TILE_SIZE`, so renaming the constant changes nothing.
- **Unwrapping in longitude space before the linear rescale** (EPSG:3857's `x` is exactly linear in longitude, so correct the longitude via the `unwrapEastLng` comparison before that linear step, instead of correcting the wrapped `x` after) looked promising enough on a first pass to conclude it might extend the safe range to just under 360° — the reference sits at one *edge* of the piece, not its center, so the usable budget in the one direction the piece extends is still capped at just under 180°. Moving the correction earlier doesn't change how much information the projection already threw away.

**What breaks the wall**: the reference doesn't have to be fixed — it can be *recomputed per vertex* from geometry that's already trusted and already width-independent. `unwrapEastLng` and the corner data `antimeridianCut` derives from it are exactly this: a one-shot, corner-level comparison (`normalizeSourceBbox` in `mosaic-layer.ts` uses the identical idiom for `MosaicLayer` source indexing) that works at *any* width, because comparing two known longitudes against each other never degrades the way a magnitude test against a constant does. `unwrapCommonSpaceX`'s `expectedX` is that same idiom's output, extended from "once, at the corners" to "at every vertex's own position" — each vertex's reference tracks where *that vertex* sits, so it stays close to the true value everywhere across the piece, no matter how wide the piece is.

This also isn't the neighbor-relative phase-unwrap family that sank #374 (walking samples in spatial order, accumulating an offset from neighbor to neighbor — order-dependent, and one bad sample corrupts everything downstream). Each vertex's reference here is computed independently, straight from validated corner geometry; there's no walk order and no dependency between vertices.

**The one limit that's left isn't a new one.** The correction is only meaningful if the tile's own corner longitudes describe a real, non-self-overlapping span — total width under 360°. A tile ≥360° wide already has two pixel columns claiming the same real-world longitude, which is invalid data with no correct rendering regardless of how it's cut or corrected — not a limitation this fix introduces or fails to solve. `antimeridianCut` rejects such a tile outright (`MAX_TOTAL_SPAN_DEG = 359.9°`, checked once against the tile's total width), falling back to a single full-mesh render the same way an unsupported slanted or curved cut does — see "Locating and selecting a crossing tile in the traversal" below. (An earlier revision of this fix instead rejected any *piece* ≥170° wide — `MAX_PIECE_SPAN_DEG` — before the per-vertex mechanism above removed that narrower limit.)

<details>
<summary>Attempt 1's original text (superseded, kept for history)</summary>

The fix is local to the **wrapped (negative-side) piece** only: in its `forwardReproject`, **if the projected X comes back positive, subtract one world-width** (the +max boundary → −max). Within that piece the *only* vertex proj4 places on the positive side is the ±180° seam, so this single sign test flips exactly the seam corner and leaves the interior untouched. It is **output-sign-based, not an input-value test** — the seam may be lng +180° or −180° depending on the source's longitude convention, and both pieces share the same seam *input*, so only *which piece* you're rendering decides the handling (known at cut time: the wrapped piece is the one whose interior projects to negative X). `inverseReproject` is unchanged: the piece is now a clean negative range the stock inverse maps back correctly. This is **not** the general phase-unwrap that sank #374 — the piece is known a priori to be wholly on the negative side, so the rule is trivial and deterministic.

</details>

### Locating and selecting a crossing tile in the traversal

> **Added 2026-09-29.** Not in the original design — found once the mechanism above shipped: a crossing tile disappeared once zoomed in tight enough on one side alone that ±180° itself scrolled out of view, reappearing as soon as the seam came back into view. Root cause was that `raster-tile-traversal.ts`'s frustum-culling traversal had no antimeridian awareness at all — three compounding defects, all in `packages/deck.gl-raster/src/raster-tileset/`:

1. **Malformed per-tile bounding volume** — see the updated "Traversal" bullet above. Fixed by reusing `unwrapCommonSpaceX` in `_getGenericBoundingVolume`.
2. **Malformed dataset-level bounds.** The same problem one level up: `wgs84Bounds` (the `insideBounds` pre-filter checked before frustum culling on every tile) is a naive min/max over densified samples, which for a crossing dataset doesn't correspond to the real west/east corners. Once (1) was fixed this caused a *new* failure — the corrected tile box and the uncorrected dataset box only touched at `x=512` instead of overlapping, rejecting the tile at every zoom. Fixed in `getTileIndices` by recomputing the dataset's own bounds from its real corner longitudes when the dataset itself crosses.
3. **World-copy offset-pass gate tied to the wrong condition.** The extra ±1..±`MAX_MAPS` bounding-volume passes (for `renderWorldCopies`/repeat mode) were gated on `viewport.subViewports.length > 1` — whether the *viewport's own* visible span currently straddles a ±180° multiple. That's unrelated to whether a *tile's* position is on a different world-copy frame than the viewport's canonical one, which is what the offset passes actually need to answer. Once zoomed in tight to one side, this wrongly skipped the exact offset pass that would have placed the (now correctly shaped) bounding volume in front of the frustum. Fixed by gating on `viewport.subViewports != null` instead — "repeat mode is active at all," not "the viewport itself currently straddles a seam." The early-break in the offset walk keeps this cheap when nothing is near a seam.

The same three-defect pattern, adapted to `MosaicTileset2D`'s structurally different Flatbush/lng-lat-bbox spatial index (`packages/deck.gl-geotiff/src/mosaic-layer/mosaic-tileset-2d.ts`), needed only the world-copy-gate fix (its own version of #3) — a crossing source's bbox is normalized onto a continuous frame by `normalizeSourceBbox` (`mosaic-layer.ts`) before indexing, so it's found only by a query shifted ±360°, ±720°…, which the same `subViewports != null` gate now permits once zoomed in tight. `MultiCOGLayer extends RasterTileLayer`, so it already inherited defects #1/#2's fixes (and the seam-handling fix above) for free via the shared mesh/traversal code.

Defect #3's `MAX_MAPS = 3` cap (the number of extra world-copy offset passes the traversal walks) turned out not to need any change for wide pieces either, despite the "Seam handling" fix above allowing much wider pieces than before: each piece's corrected `x` is bounded by construction to `[0, tileSize]` for any tile under the `MAX_TOTAL_SPAN_DEG` limit, so a piece never needs more than the world copies ordinary (non-crossing) tiles already rely on. See [`world-copies.md`](../world-copies.md) for the general offset-search mechanism this all sits on top of.

### Why not render-as-one

Render-as-one is simpler at the render layer (one mesh, one draw, no internal seam) and more CRS-general (it unwraps the output value, indifferent to source pixel geometry). But it re-attempts the exact unwrap that has failed three times: detection needs phase-unwrapping (a full-world continuous tile must not be mistaken for a crossing tile), mesh vertices leave `[0, 512]` (precision risk), and forward+inverse must stay consistent. We choose cut-in-two as the primary mechanism and keep **render-as-one as the documented fallback for curved-meridian CRS** (see Scope), where cut-in-two degrades.

## Locating the cut

Compute the cut generally by **inverse-projecting the antimeridian into source space**: sample `(180°, lat)` for `lat ∈ [−90, 90]`, run each point through `descriptor.projectFrom4326` (WGS84 → source CRS) then the inverse geotransform → a polyline in source pixel / UV space. This is robust to rotated geotransforms and arbitrary CRS (it does not assume the cut is the `lng = 180°` pixel column).

The cut's **shape** determines feasibility:

- **Straight cut** (axis-aligned EPSG:4326 → vertical; rotated geotransform → slanted): a straight line splits the unit square into two **convex** pieces.
- **Curved cut** (curved-meridian CRS): at least one piece is **concave**.

The MVP handles **any straight cut** — vertical (axis-aligned EPSG:4326) *and* slanted (rotated geotransform) — since both yield convex pieces that delaunator triangulates exactly. It **errors clearly** only when the inverse-projected meridian is *curved* (concave pieces; curved-meridian CRS), which is deferred.

## Architecture

The split lives in **one place** — the per-tile sublayer factory — and every other component keeps its single-mesh contract.

```
RasterTileLayer._renderSubLayers (per tile)        ← the only split point
  ├─ normal tile   → 1 RasterLayer  → 1 RasterReprojector → 1 mesh → 1 MeshTextureLayer
  └─ crossing tile → 2 RasterLayers → (each) 1 reprojector → 1 mesh → 1 MeshTextureLayer
```

- **`RasterReprojector`** ([`delatin.ts`](../../packages/raster-reproject/src/delatin.ts)) — one mesh, always. Gains an optional **initial-triangulation seed** `{ uvs, triangles, halfedges }` (delaunator's shape), defaulting to today's unit-square 2-triangle seed. The refinement core (`_step`, `_legalize`, `_findReprojectionCandidate`, the error queue) is already seed-agnostic; only the constructor's hardcoded init changes. Refinement only ever *splits existing triangles*, so a seed covering `[0, u_cut]×[0,1]` keeps the whole mesh in that sub-region. `width`/`height` stay the full image, so sub-domain UVs index the full texture — no texture re-windowing.
- **Seed building (no shipped wrapper)** — `raster-reproject` exposes only the `InitialTriangulation` type, not a builder. Wrapping delaunator is a one-liner, so its docstring documents the pattern instead (`uvs`/`triangles`/`halfedges` = delaunator's `coords`/`triangles`/`halfedges`). delaunator is a **dev/test dependency** of `raster-reproject` — used by tests to validate winding compatibility — *not* a runtime dependency, so nothing is shipped to consumers. The deck.gl-raster cut builder (follow-up) constructs each convex-piece seed at runtime; whether that uses delaunator (a runtime dep there) or a hand-rolled convex-fan triangulation is decided in the integration plan.
- **Cut builder** (deck.gl-raster) — computes the cut (inverse-project the antimeridian) → 1 or 2 sub-domain seeds. Lives in the tileset's `getTileMetadata` and is stored on tile metadata (per the "tile state on the tile" convention), so it is computed once and shared by both the render and the bounding volume.
- **`RasterLayer`** ([`raster-layer.ts`](../../packages/deck.gl-raster/src/raster-layer.ts)) — one mesh, one `MeshTextureLayer`, unchanged except a new `initialTriangulation` prop (default: full square) passed to its reprojector.
- **`RasterTileLayer._renderSubLayers`** — reads the tile's cut info and emits 1 or 2 `RasterLayer`s. Both crossing sub-layers share the **same** `reprojectionFns` (the tile's `_projectPosition`); they differ only in `initialTriangulation` and sublayer id (`…-raster-west` / `…-raster-east`).
- **Traversal** — originally planned as a **two-box bounding volume** for a crossing tile (west ≈ `[510,512]`, east ≈ `[0,2]`). **As implemented**, it's one tight box instead: the traversal's `_getGenericBoundingVolume` (`raster-tile-traversal.ts`) applies the same `unwrapCommonSpaceX(x, u, cut, tileSize)` correction used by `forwardReproject` to its 9 sampled reference points (`u` = each point's own `relX`) before fitting the `OrientedBoundingBox`, so a crossing tile gets a single box straddling `x=512` rather than one spanning most of `[0,512]` — correct for a piece of any width up to the `MAX_TOTAL_SPAN_DEG` self-overlap limit, not just a narrow one. See "Locating and selecting a crossing tile in the traversal" below for why a second, independent fix was also needed here.

## Transparency to end users

The split is entirely below the tile-data boundary:

- **`getTileData` is unchanged.** A crossing tile is one tile index `(x, y, z)` and a single *contiguous* source-pixel fetch — the discontinuity appears only when projecting to 3857, after fetch. Any data source (COG, zarr, user-supplied) needs zero antimeridian awareness, and the tile is decoded once (both pieces sample the one texture).
- **`_renderSubLayers` is library-internal** — standard `COGLayer` / `RasterTileLayer` users never write it.

Caveat: a user who *subclasses* and overrides `_renderSubLayers` would bypass the split.

## Unification

The initial-triangulation seed subsumes several pending needs into one primitive — *the caller hands the reprojector a seed*:

- Normal tile → full unit square → 1 layer (unchanged behavior).
- Antimeridian crossing → west + east seeds → 2 layers.
- Pole clamp (#182) / `uvBounds` (#351) → one clamped-rectangle seed → 1 layer (data beyond ±85.051° is not meshed).
- Collar cutline → one inset-domain seed → 1 layer.

## Scope

**In scope:**
- Web Mercator viewport.
- Straight cut (convex pieces): axis-aligned EPSG:4326 (vertical) *and* rotated geotransforms (slanted).
- Test datasets:
  - **Primary, deterministic:** the [`antimeridian.tif`](https://github.com/developmentseed/geotiff-test-data/blob/3c7ceb9ec2ed23b0ba71c2222ac4d5e6f31db0ec/rasterio_generated/fixtures/antimeridian.tif) fixture, already vendored via the `fixtures/geotiff-test-data` submodule (`fixtures/geotiff-test-data/rasterio_generated/fixtures/antimeridian.tif`). 42×42, EPSG:4326, bbox (−204, −18, −162, 24) → crosses −180° with a clean vertical cut at pixel column 24 (lng −204 ≡ +156 wrapped).
  - **Global / edge-overhang variant:** a global EPSG:4326 COG that triggers #366 — e.g. WorldPop `ppp_2020_1km_Aggregated.tif` (from the issue) or the GEDTM30 global DEM (from #353).

**Out of scope (deferred):**
- Globe view (separate prototype).
- Curved-meridian / polar CRS (concave pieces). delaunator fills the convex hull, so a concave piece would gain triangles across the seam; handling needs centroid-filtering or constrained Delaunay, or the render-as-one fallback. The MVP errors on a non-straight cut.

## Edge cases & risks

- **Degenerate slivers:** the half-pixel-overhang case (`−180.0012°`) splits into a sub-pixel sliver + a main piece. Skip pieces below an ε UV width so we don't emit a degenerate mesh.
- **Seam between pieces:** west's cut edge lands at common-x 512, east's at common-x 0 — each piece sits at its own natural position (see "Seam handling" above) rather than a shared frame, and abut across the world-copy boundary via deck.gl's own repeat-rendering. Encode the shared edge bit-identically (same discipline as adjacent tiles, [`coordinate-systems.md`](../coordinate-systems.md)).
- **delaunator ↔ delatin orientation:** this repo's delatin works in UV (y-down). Verify winding/`inCircle` compatibility with a test (delaunator on the 4 unit-square corners → seed → delatin refines identically to the current hardcoded init).
- **Texture upload:** both sublayers reference the same tile image; without a shared luma `Texture` it uploads twice. Negligible for the prototype (dateline tiles are a thin strip); optimize later if needed.

## Test plan

**Unit**
- Reprojector seeded with a delaunator-built sub-rectangle (the documented pattern) converges and adds no vertices outside the seed domain; a delaunator unit-square seed refines validly (winding compatibility), equivalent to the current default.
- Cut location: inverse-projecting the antimeridian yields the expected cut line — a vertical UV column for axis-aligned EPSG:4326 (the `antimeridian.tif` fixture cuts at column 24 / `u ≈ 0.571`), a slanted line for a rotated geotransform; a *curved* cut is detected and errors.
- Bounding volume for a crossing tile is a single tight box straddling the seam (not one spanning most of `[0,512]`); correct selection under the world-copy traversal, including when zoomed in tight to one piece alone (see "Locating and selecting a crossing tile in the traversal" above).

**Integration / visual (cog-basic)**
- The `antimeridian.tif` fixture renders as a single contiguous image across ±180° (west piece near +180°, east piece near −180°), staying continuous when panning across the seam.
- A global EPSG:4326 COG (WorldPop / GEDTM30) renders correctly at the dateline (no `error=43200` divergence; no mislocated rectangles).
- Before/after comparison against current main.

## Implementation stages (high level)

1. `RasterReprojector` accepts an `InitialTriangulation` seed (default unchanged); `InitialTriangulation` docstring documents the delaunator pattern; delaunator added as a dev dependency; tests use a delaunator-built seed to validate winding + sub-domain confinement. **(Done.)**
2. Cut location (inverse-project the antimeridian) + convexity check (error on a curved/concave cut), on tile metadata.
3. Two-box bounding volume in traversal for crossing tiles.
4. `RasterLayer` `initialTriangulation` prop; `_renderSubLayers` emits 1 or 2 `RasterLayer`s, each seeded from its cut sub-domain.
5. Example wiring + visual validation in cog-basic.

(Detailed task breakdown lives in the implementation plan, not here.)
