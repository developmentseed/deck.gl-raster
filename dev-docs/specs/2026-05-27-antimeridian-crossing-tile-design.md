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

Splitting at the antimeridian is *almost* enough — but not quite. proj4 normalizes ±180° to the **positive** boundary (+max_X / common-x 512). That's correct for the west piece (its right edge *is* +180°), but the east piece's left edge is also the antimeridian and must sit at common-x 0 (−max_X). With stock proj4 the east piece's seam corner lands at 512 while its interior is near 0, so its seed triangle still spans the world and the reprojector diverges — the original #366 failure.

The fix is local to the **wrapped (negative-side) piece** only: in its `forwardReproject`, **if the projected X comes back positive, subtract one world-width** (the +max boundary → −max). Within that piece the *only* vertex proj4 places on the positive side is the ±180° seam, so this single sign test flips exactly the seam corner and leaves the interior untouched. It is **output-sign-based, not an input-value test** — the seam may be lng +180° or −180° depending on the source's longitude convention, and both pieces share the same seam *input*, so only *which piece* you're rendering decides the handling (known at cut time: the wrapped piece is the one whose interior projects to negative X). `inverseReproject` is unchanged: the piece is now a clean negative range the stock inverse maps back correctly. This is **not** the general phase-unwrap that sank #374 — the piece is known a priori to be wholly on the negative side, so the rule is trivial and deterministic.

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
- **Traversal** — a **two-box bounding volume** for a crossing tile (west ≈ `[510,512]`, east ≈ `[0,2]`), each a normal `[0,512]` box, mapping 1:1 to the two `RasterLayer`s and composing with the world-copy traversal's per-offset selection (a crossing tile natively occupies two world bands at offset 0).

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
- **Seam between pieces:** west's cut edge lands at common-x 512, east's at 0 ≡ 512 in the +1 world copy — they abut across the world-copy boundary. Encode the shared edge bit-identically (same discipline as adjacent tiles, [`coordinate-systems.md`](../coordinate-systems.md)).
- **delaunator ↔ delatin orientation:** this repo's delatin works in UV (y-down). Verify winding/`inCircle` compatibility with a test (delaunator on the 4 unit-square corners → seed → delatin refines identically to the current hardcoded init).
- **Texture upload:** both sublayers reference the same tile image; without a shared luma `Texture` it uploads twice. Negligible for the prototype (dateline tiles are a thin strip); optimize later if needed.

## Test plan

**Unit**
- Reprojector seeded with a delaunator-built sub-rectangle (the documented pattern) converges and adds no vertices outside the seed domain; a delaunator unit-square seed refines validly (winding compatibility), equivalent to the current default.
- Cut location: inverse-projecting the antimeridian yields the expected cut line — a vertical UV column for axis-aligned EPSG:4326 (the `antimeridian.tif` fixture cuts at column 24 / `u ≈ 0.571`), a slanted line for a rotated geotransform; a *curved* cut is detected and errors.
- Two-box bounding volume for a crossing tile (west/east boxes; correct selection under the world-copy traversal).

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
