# Globe view: a rendering prototype

- **Date:** 2026-05-21
- **Issues:** none yet
- **Status:** Proposed
- **Related:** [`dev-docs/coordinate-systems.md`](../coordinate-systems.md) — projection/precision background

## Context

We want to render raster tiles on a 3D globe (deck.gl `GlobeView` /
MapLibre `projection="globe"`) instead of only the flat Web Mercator map.

Exploration found the globe path is **~70% scaffolded but does not work**:

- The render path already branches on globe
  ([`raster-tile-layer.ts` `isGlobe`](../../packages/deck.gl-raster/src/raster-tile-layer/raster-tile-layer.ts)),
  setting `coordinateSystem: "lnglat"` and reprojecting tile vertices to
  WGS84 via `descriptor.projectTo4326`. It has never been exercised.
- Tile selection **crashes**: `computeBoundingVolume` does
  `assert(false, "TODO: implement getBoundingVolume in Globe view")`
  ([`raster-tile-traversal.ts`](../../packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts))
  whenever a globe `project` function is supplied — i.e. immediately, in any
  `GlobeView`.
- **No globe example exists.** Every example overlays deck.gl on MapLibre via
  `MapboxOverlay` ([`deckgl-overlay.tsx`](../../examples/_shared/components/deckgl-overlay.tsx)),
  riding MapLibre's mercator camera.

deck.gl 9.3 [fully supports MapLibre's globe projection](https://deck.gl/docs/api-reference/mapbox/overview)
and keeps a `MapView` **or `GlobeView`** in sync with the map. So rendering
deck.gl layers **interleaved** over a `<Map projection="globe">` should hand
our layers a `_GlobeViewport` (with `resolution` set) — exactly what both the
`isGlobe` render branch and the traversal's globe detector key off — and the
basemap comes for free from MapLibre.

The intended outcome of *this* spec: a working globe prototype that exercises
the real code paths end-to-end, plus a clear, sequenced path to production.

## Scope

**In scope (this spec):**

1. Implement the globe tile-selection bounding volume (clear the `assert`).
2. Make the lng/lat render path correct (a small, documented shader change).
3. A `cog-globe` example (and near-free `zarr-globe` sibling) over MapLibre
   globe.
4. A clearly-throwaway anti-faceting scaffold so the prototype is legible.

**Deliberately out of scope (own follow-up design):**

- **Spherical reprojection correctness.** The reprojector
  ([`packages/raster-reproject`](../../packages/raster-reproject/src/delatin.ts))
  was designed for **linear output spaces**; reprojecting onto a sphere is
  nonlinear, and its pixel-space error metric is blind to faceting (see
  "Faceting" below). Choosing the right error metric / mesh strategy for a
  sphere deserves a dedicated brainstorm + spec. We render first so that
  design can be validated against a live globe.
- **Cutline on globe** — disabled on globe for now
  ([`cutline-bbox.ts`](../../packages/deck.gl-raster/src/gpu-modules/cutline-bbox.ts)
  notes the limitation). Rather than build a `CutlineBboxGlobe` variant, we
  expect to switch cutline handling to deck.gl's `ClipExtension`
  ([#561](https://github.com/developmentseed/deck.gl-raster/issues/561)), which
  would likely make a globe-specific cutline module unnecessary.
- Sphere-normal re-orientation / lighting — rasters are unlit, so this is moot.
- Fast bounding-volume paths for 3857 / UTM sources (the "Future Case 2/3"
  TODOs in `computeBoundingVolume`).

## Design

### 1. Globe tile-selection bounding volume (the hard blocker)

Replace the `assert(false)` globe branch in
[`RasterTileNode.computeBoundingVolume`](../../packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts)
with an implementation that mirrors the existing generic case
(`_getGenericBoundingVolume`), swapping the "reproject → EPSG:3857 → rescale to
common space" step for "reproject → WGS84 → project to the globe sphere":

- Sample the tile's reference points (reuse `REF_POINTS_9` and the existing
  reference-point sampling) in the source CRS.
- Reproject them to **WGS84 lng/lat** via `descriptor.projectTo4326` (instead
  of `projectTo3857`).
- Map each `[lng, lat, z]` through the supplied `project` function (=
  `viewport.projectPosition`, already threaded in for globe at
  [`raster-tile-traversal.ts` ~L740](../../packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts))
  to obtain 3D positions in deck.gl's globe common space.
- Build the volume with `makeOrientedBoundingBoxFromPoints(...)` — already used
  by the generic path. An **oriented** box (not axis-aligned) is required
  because tiles project to non-axis-aligned volumes on the sphere.
- Define `commonSpaceBounds` for globe from the projected 3D points (it is a
  coarse pre-filter; document the chosen semantics).

This follows upstream deck.gl's globe tile-volume convention (the code already
notes "Only define `project` function for Globe viewports, same as upstream").

**Cache fix.** [`BoundingVolumeCache`](../../packages/deck.gl-raster/src/raster-tileset/bounding-volume-cache.ts)
is keyed by `z/x/y` only and explicitly assumes non-globe traversal. A globe
volume lives in a different common space than its mercator counterpart, so the
cache must not collide them: add a projection-mode discriminator to the key (or
invalidate the cache when the projection mode changes).

### 2. Render path: lng/lat-direct + a documented shader unification

Rendering on the globe should use lng/lat directly (`coordinateSystem:
"lnglat"`, mesh vertices = lng/lat from `projectTo4326`). deck.gl's globe
projection maps lng/lat → sphere exactly, so there is **no projection
distortion** and **no need** for the manual common-space mapping the mercator
path uses (that mapping exists only as a high-zoom *precision* workaround).

The wrinkle: `MeshTextureLayer` extends `SimpleMeshLayer`, whose vertex shader
picks a branch via `shouldComposeModelMatrix(viewport, coordinateSystem)` —
`true` for `cartesian`, **`false` for `lnglat`**. The `false` branch
([`mesh-layer-vertex.glsl.ts`](../../packages/deck.gl-raster/src/mesh-layer/mesh-layer-vertex.glsl.ts))
assumes the mesh is a small **meters-scale** model offset from an anchor and
runs `project_size(pos)` — which, applied to lng/lat **degrees**, is garbage
and would not land on the sphere.

`MeshTextureLayer` always draws exactly **one** non-instanced, identity-transform
mesh at the origin ([`mesh-layer.ts`](../../packages/deck.gl-raster/src/mesh-layer/mesh-layer.ts)),
so the instanced / model-orient branches never apply. **Unify the vertex
shader to a single, documented direct-projection path:**

```glsl
gl_Position = project_position_to_clipspace(pos, positions64Low, vec3(0.0), position_commonspace);
```

This is exactly what the cartesian path already collapses to today (anchor =
`[0,0,0]`), and it makes the lnglat (globe) path correct identically. It also
keeps the per-vertex `positions64Low` in play, so the lng/lat path retains
**full fp64 precision** (sub-cm) — no precision penalty for rendering lng/lat
directly. Document the change in the shader header (extending the existing
upstream-override note) and in `dev-docs/coordinate-systems.md`.

### 3. Faceting: a throwaway scaffold (not the real fix)

A raster tile covers a lng/lat patch that is curved on the sphere; we draw flat
triangles whose faces (chords) sag below the true surface between vertices. At
low zoom a tile spans many degrees, so a coarse mesh visibly facets — the globe
looks like a cut gem.

The current Delatin error metric cannot fix this. It measures *tangential*
reprojection error in pixel space (inverse-reproject the interpolated/chord
point and compare pixels). Faceting is a *radial* deviation, and the chord
point projects radially to the **same lng/lat** as the true point — so the
metric sees ~zero error. For a 4326 source the reprojection is the identity, so
Delatin emits the minimal 2 triangles → maximal faceting.

Fixing this properly is the deferred reprojection design. For the prototype,
add a **clearly-marked, temporary** anti-faceting scaffold so culling, tile
loading, seams, and precision are all evaluable on a smooth-enough globe:

- In globe mode only, build a **uniform grid mesh** per tile (e.g. an `N×N`
  grid in pixel/UV space, mapped to lng/lat via the existing `forwardTransform`
  + `forwardReproject`), bypassing Delatin's adaptive refinement. This keeps
  the reprojector **untouched** (we are deferring reprojector changes) and is
  trivially removable once the sphere-aware reprojection lands.
- Mark it unmistakably as throwaway in code comments, pointing to the future
  reprojection spec.

### 4. Examples: `cog-globe` (+ `zarr-globe`)

New `examples/cog-globe/`, modeled on `cog-basic` / `land-cover`:

- `<Map projection="globe">` (react-map-gl / MapLibre) supplying the globe
  basemap and controls.
- `DeckGlOverlay` with `interleaved` (required for globe alignment).
- A `COGLayer` pointed at a **global EPSG:4326 COG** (see open question on URL).

`examples/zarr-globe/` is a near-free sibling reusing the global ECMWF Zarr
data and `ZarrLayer` from `dynamical-zarr-ecmwf`. The core work (bounding
volume + shader fix + scaffold) is shared; each example is a thin wrapper.

## Files to touch

- `packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts` —
  implement the globe `computeBoundingVolume` case.
- `packages/deck.gl-raster/src/raster-tileset/bounding-volume-cache.ts` —
  projection-aware cache key.
- `packages/deck.gl-raster/src/mesh-layer/mesh-layer-vertex.glsl.ts` (and
  `mesh-layer.ts` if needed) — unify to the direct-projection path + docs.
- `packages/deck.gl-raster/src/raster-layer.ts` — globe-mode uniform-grid mesh
  scaffold (gated on `isGlobe`).
- `examples/cog-globe/` (new), `examples/zarr-globe/` (new).
- `dev-docs/coordinate-systems.md` — document the globe path and shader change.

## Verification

1. `pnpm build` the affected packages.
2. `pnpm --filter cog-globe dev` (and `zarr-globe`) and load in a browser.
3. Confirm:
   - No `assert` throw — globe tile selection runs.
   - The mosaic drapes onto the globe and is geographically aligned with the
     MapLibre basemap (interleaved).
   - Panning / zooming culls correctly (tiles load and unload; off-screen and
     back-of-globe tiles are not drawn).
   - No tile-boundary seams.
   - No jitter at the zooms globe view is actually used (fp64 path intact).
   - Faceting is acceptable with the scaffold enabled.
4. Tests (vitest, matching existing patterns): globe `computeBoundingVolume`
   produces a sane oriented box for a known tile; globe-mode tile selection
   returns expected indices for a known viewport.

## Open questions / risks

- **Primary risk:** does MapLibre `projection="globe"` + `MapboxOverlay`
  (`interleaved`) actually hand our layers a `_GlobeViewport` with `resolution`
  set under deck.gl 9.3? The whole design assumes yes; confirm empirically
  early (it gates everything).
- **Global 4326 COG URL** — needs a concrete, public, whole-globe EPSG:4326
  COG. Candidates: EOx Sentinel-2 cloudless, Natural Earth, Blue Marble; or host
  one in the project's `ds-deck.gl-raster-public` S3 bucket. To confirm during
  implementation.
- `commonSpaceBounds` semantics for the globe case (coarse pre-filter only).
- Exact scope of the `BoundingVolumeCache` key change.

## Sequenced path to production

1. **This spec** — rendering prototype (above).
2. **Spherical reprojection correctness** (own brainstorm + spec): the right
   error metric / mesh strategy for a sphere; removes the scaffold. The
   reprojector's linear-output-space assumption is revisited here.
3. Re-enable cutline on globe — likely by switching to deck.gl's
   `ClipExtension` ([#561](https://github.com/developmentseed/deck.gl-raster/issues/561))
   rather than building a `CutlineBboxGlobe` module.
4. Tests for globe selection + a globe render check in CI.
