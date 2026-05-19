# Fix high-zoom jitter from float32 mesh positions

- **Date:** 2026-05-19
- **Issues:** [#512](https://github.com/developmentseed/deck.gl-raster/issues/512)
- **Status:** Proposed

## Problem

At high zoom (≳ z16) over high-resolution imagery (sub-meter NAIP, for
example), the rendered raster jitters by sub-meter amounts during pan and
zoom. The basemap underneath stays put; only the raster moves. Reported in
[#512](https://github.com/developmentseed/deck.gl-raster/issues/512) with a
NAIP mosaic reproducer.

The cause is float32 quantization of mesh vertex positions. The reprojector
emits exact output positions in EPSG:3857 meters as JS doubles
(`packages/raster-reproject/src/delatin.ts`, `_addPoint` →
`exactOutputPositions: number[]`). `RasterLayer._generateMesh`
(`packages/deck.gl-raster/src/raster-layer.ts`) then writes those values into
a `Float32Array` for the GPU. EPSG:3857 meters range up to ±2.0×10⁷ near the
edges of the world; float32 holds ~7 significant decimal digits, so stored
values quantize to roughly 1–2 m steps in that range. At z16 a pixel is
~2.4 m on the ground, so the quantization is visible as jitter; at z18 a
pixel is ~0.6 m and the jitter dominates.

deck.gl's own auto-offset (`WEB_MERCATOR_AUTO_OFFSET`, kicks in at
zoom ≥ 12 — see
[`Viewport.projectionMode`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/viewports/viewport.ts#L205-L212))
does not rescue us. Auto-offset re-anchors the projection to the viewport center on the CPU
in float64, then runs camera-relative math in float32 in the shader. That
fixes the *camera-relative* precision, but the precision of our vertex
attribute is already gone before the shader runs — we lost it when we
quantized 10⁷-magnitude numbers to float32 on the CPU. Auto-offset works for
ordinary geospatial layers because those layers store LNGLAT degrees
(magnitudes ≲ 180), which float32 represents with sub-cm precision
everywhere.

## Goal

Eliminate the float32 quantization at the vertex-attribute level for the
tile path, so panning at z16+ over high-resolution imagery is jitter-free
and matches the basemap.

## Non-goals

- The standalone `RasterLayer` (used without `RasterTileLayer`) is out of
  scope. With the design below, its behavior is unchanged unless a caller
  opts in by passing the new prop.
- Globe mode is out of scope. We do not handle globe-projected raster yet
  anywhere; revisit when we do.
- Switching to deck.gl's `meter-offsets` coordinate system. It interprets
  the position attribute as true ground meters relative to a lng/lat anchor
  via `addMetersToLngLat`. Our reprojector emits EPSG:3857 meters, which
  include the Mercator stretch `1/cos(lat)`. Using `meter-offsets`
  unchanged would render tiles at the wrong size at high latitudes
  (~2× too small at 60°N) and drift off the Mercator basemap. Converting
  3857 meters → ground meters per tile is possible but adds CPU cost and
  decouples our coordinate convention from the basemap; not worth it for
  this fix.
- A `fp64` / double-precision attribute path. Doubling attribute memory and
  the shader vertex cost is unnecessary when the split-precision trick
  below gives the same end result.

## Approach

Split-precision rendering, applied to the vertex attribute. Each tile picks
a reference point in EPSG:3857 meters; mesh positions are stored as float32
*offsets* from that reference; the reference itself is folded into the
layer's `modelMatrix` translation, computed on the CPU in float64. This is
the same algebraic identity deck.gl uses for auto-offset — applied one
layer down, at the attribute, where our precision is actually being lost.

For a tile reference point `ref` (in 3857 meters), the rendered position is

```
scale · (p − ref) + scale · ref + [TILE_SIZE/2, TILE_SIZE/2, 0]
  = scale · p + [TILE_SIZE/2, TILE_SIZE/2, 0]
```

— identical to today's output. Quantization moves from `p` (magnitude
~10⁷) to `p − ref` (magnitude bounded by the tile's half-extent — ≤ ~2×10⁷
at z0, halving each level, ≲ 20 m by z20). The `modelMatrix` translation
`scale · ref` is computed in JS as float64 and survives intact into the
shader uniform; the GPU only adds a small float32 attribute to a precise
uniform.

### Reference point: tile centroid

`RasterTileLayer._renderSubLayers` already has `tile.projectedCorners`
attached by `RasterTileset2D.getTileMetadata` — the four tile corners in
projected (EPSG:3857) coordinates, preserving any rotation. The reference
point is the centroid of those four corners. This works for axis-aligned
and rotated tiles alike. No new tile metadata is required.

### Always-on, no zoom threshold

The shift is applied unconditionally for every tile. Rationale:

- Cost is negligible. One centroid (4 adds, 1 div) per tile and one float64
  subtraction per mesh vertex during mesh generation. Mesh generation
  already runs delatin per tile, which dominates this.
- Never worse than today. At very low zoom the tile centroid is near the
  origin (z0: a single tile, centroid (0,0); z1: four tiles, centroid
  ±10⁷). Stored magnitudes are at most equal to today's. Above z2 they
  shrink geometrically with zoom level, and precision improves
  monotonically.
- A threshold would add branching, a tuning parameter, and two code paths
  to test for marginal savings.

## Scope of change

Two files, plus a unit test. No public API break.

- `packages/deck.gl-raster/src/raster-layer.ts`
  - Add an optional prop to `RasterLayerProps`, e.g.
    `referencePointMeters?: [number, number] | null` (default `null`).
  - In `_generateMesh` / `reprojectorToMesh`, subtract
    `referencePointMeters` from each `exactOutputPositions[i*2 + 0/1]`
    when filling the `Float32Array`. When `null`, behave exactly as today.
  - Add `props.referencePointMeters` to the `updateState` change detection
    so a changed reference point regenerates the mesh.
- `packages/deck.gl-raster/src/raster-tile-layer/raster-tile-layer.ts`
  - In `_renderSubLayers`, in the non-globe branch, compute
    `ref = centroid(tile.projectedCorners)` in 3857 meters.
  - Fold the reference into the `modelMatrix` translation that's already
    being built. The current matrix is `diag(scale, scale, 1, 1)`; the new
    one adds translation `[scale · ref_x, scale · ref_y, 0]`. Reference
    equality across renders must be preserved so `MeshTextureLayer`'s
    model-rebuild gating still holds — memoize the matrix per tile, or
    attach it to the tile metadata at creation, the same way
    `forwardTransform` / `inverseTransform` are.
  - Pass `referencePointMeters: ref` to the inner `RasterLayer`.

### Reference-equality discipline

`RasterLayer.updateState` regenerates the mesh whenever any of its
inputs change. `RasterTileLayer._renderSubLayers` must therefore hand the
inner `RasterLayer` a *stable* `referencePointMeters` reference across
renders of the same tile — otherwise we'll regenerate the mesh every
render and tank performance. The natural place to live is `RasterTileMetadata`
on the tile object (computed once at tile creation, alongside
`forwardTransform` / `inverseTransform`), or memoized per-tile in
`_renderSubLayers`. Same applies to the per-tile `modelMatrix`: stable
reference, computed once.

## Verification

- Unit test in `packages/deck.gl-raster/tests/raster-layer.test.ts`
  covering `_generateMesh`:
  - Without `referencePointMeters`, the resulting `POSITION` buffer matches
    today's output exactly (regression guard).
  - With a non-zero `referencePointMeters` near a sample's true 3857
    position (~10⁷ m magnitude), reconstructing
    `position_f32 + ref_f64` recovers the original double-precision input
    to within float32 ULP near zero (i.e. ≤ ~10⁻⁴ m), which is ≥ 10⁴× tighter
    than today's ~1 m quantization at the same input magnitude.
- Manual browser check using the NAIP mosaic example (the
  [#512](https://github.com/developmentseed/deck.gl-raster/issues/512)
  reproducer): pan and zoom around z18 and confirm the raster no longer
  drifts relative to the basemap.

## Risks

- **Stale reference equality.** If `referencePointMeters` or `modelMatrix`
  is recreated each render, the inner `RasterLayer` regenerates its mesh
  every frame. The change-detection in `RasterLayer.updateState` and the
  model rebuild in `MeshTextureLayer.updateState` both rely on stable
  references. Mitigation: store the per-tile `referencePointMeters` and
  `modelMatrix` on the tile metadata at tile creation, the same way
  `forwardTransform` is today, and pass those exact references in
  `_renderSubLayers`.
- **Picking and other downstream uses of mesh positions.** `RasterLayer`'s
  debug overlay reads back `reprojector.exactOutputPositions` directly
  (still in 3857 meters, unaffected). The mesh `POSITION` buffer is
  consumed by `SimpleMeshLayer`, which only feeds it to the projection
  shader — no app-visible position read-back. Low risk.
- **Negligible run-time cost.** One centroid per tile, one vector subtract
  per vertex during mesh gen. Mesh gen is already delatin-bound.

## Out of scope follow-ups

- Apply the same split-precision approach to the standalone `RasterLayer`
  by either (a) auto-deriving a reference from the input positions, or
  (b) requiring callers to pass `referencePointMeters`. Defer until a
  user reports the same jitter outside the tile path.
- Globe-mode precision. Revisit when globe-projected raster ships.
