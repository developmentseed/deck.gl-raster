# Fix high-zoom jitter via fp64 mesh-vertex attributes

- **Date:** 2026-05-19
- **Issues:** [#512](https://github.com/developmentseed/deck.gl-raster/issues/512)
- **Status:** Proposed
- **Related:** [`dev-docs/coordinate-systems.md`](../coordinate-systems.md) — background and gotchas

## Problem

At high zoom (≳ z16) over high-resolution imagery (sub-meter NAIP, for
example), the rendered raster jitters by sub-meter amounts during pan and
zoom. The basemap underneath stays put; only the raster moves. Reported in
[#512](https://github.com/developmentseed/deck.gl-raster/issues/512) with a
NAIP mosaic reproducer.

## Root cause

Mesh vertex positions are quantized to float32 before reaching the GPU.
The reprojector emits exact output positions in EPSG:3857 meters as JS
doubles ([`packages/raster-reproject/src/delatin.ts`](../../packages/raster-reproject/src/delatin.ts), `_addPoint` →
`exactOutputPositions: number[]`). [`RasterLayer._generateMesh`](../../packages/deck.gl-raster/src/raster-layer.ts)
then writes those values into a `Float32Array` for the GPU.

EPSG:3857 meters range up to ±2.0×10⁷ near the edges of the world.
Float32 holds ~7 significant decimal digits, so values at that magnitude
quantize in steps of roughly 1–2 m. At z16 a pixel is ~2.4 m on the ground,
so the quantization is visible as jitter; at z18 a pixel is ~0.6 m and the
jitter dominates.

## Why deck.gl's auto-offset doesn't fix this

deck.gl's `WEB_MERCATOR_AUTO_OFFSET` (zoom ≥ 12, see
[`Viewport.projectionMode`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/viewports/viewport.ts#L205-L212))
re-anchors the projection to the viewport center on the CPU in float64,
then runs camera-relative math in float32 in the shader. That fixes
*camera-relative* precision, but the precision of our vertex attribute is
already gone before the shader runs — we quantized 10⁷-magnitude numbers
to float32 on the CPU when filling the `Float32Array`. Auto-offset works
for ordinary geospatial layers because they store LNGLAT degrees
(magnitudes ≲ 180), which float32 represents with sub-cm precision
everywhere.

## What we tried first (and why it created seams)

Pre-fp64 attempts on this branch (`kyle/fix-zoom-precision-issues`, see
its git log) stored mesh positions as offsets from a per-tile reference
point (the tile centroid in 3857 meters), then folded the reference back
in via either `modelMatrix.translation` or `coordinateOrigin`. The
algebra is identical to absolute encoding, and the float32 chain looks
sub-pixel.

In practice this introduced **per-tile seams** that don't exist on `main`.
Mechanism (see also [`coordinate-systems.md`](../coordinate-systems.md) §
"Adjacent-tile boundary alignment"):

- On `main`, both adjacent tiles encode their shared boundary vertex with
  the **same absolute 3857 value** (e.g. 13,000,305). Float32
  representations are bit-identical. Both tiles' shaders run the same
  float32 instruction chain on the same bit pattern → vertex lands on the
  exact same sub-pixel position in both tiles → no rasterization
  disagreement at the seam. The price is ~1 m of global jitter (whole
  scene shifts together as auto-offset's float32 ULP snaps), which is
  visually acceptable.
- With per-tile offsets, the same shared vertex is encoded as `+305` in
  tile A and `−305` in tile B. The shader runs different float32
  arithmetic chains in each tile (`scale × 305 + tx_A` vs.
  `scale × −305 + tx_B`). Mathematically equivalent in float64, but the
  float32 chains accumulate rounding differently. The disagreement is
  mathematically sub-pixel (~10⁻⁹ world units, ~10⁻⁵ pixels at z17), but
  the GPU's rasterization coverage rounding can amplify it: if A's edge
  falls at sub-pixel position 100.4999 and B's at 100.5001, coverage
  rounds them to different pixel columns and you see a 1-pixel seam.

The seam is structural to **per-tile mesh encoding** of a shared
boundary, regardless of where the per-tile shift lives (mesh attribute,
`modelMatrix.translation`, or `coordinateOrigin`).

## Approach: fp64 attribute pairs on absolute 3857 coordinates

Keep the mesh as **absolute** 3857 meters (same as `main`) — preserves
bit-identical encoding of shared boundary vertices across adjacent tiles
— but encode each vertex as an **fp64 split pair**:

- `positions` (Float32Array high parts) — the closest float32 to each
  true float64 vertex value
- `positions64Low` (Float32Array low parts) — the residual
  `(v_f64 − Math.fround(v_f64))`, also stored as float32

The pair `(hi, lo)` together carry ~14 decimal digits of precision
(float64-equivalent at our magnitudes). deck.gl's vertex projection
shader already accepts both — [`project_position`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/shaderlib/project/project.glsl.ts#L188-L235)
takes a `position64Low` parameter and adds
`project_offset_(modelMatrix * vec4(position64Low, 0.0))` to the
result. The infrastructure is built-in and not deprecated; see
[`coordinate-systems.md`](../coordinate-systems.md) § "fp64 attribute
pairs".

### Why this preserves bit-identity across tiles

For a shared boundary vertex at absolute 3857 coordinate `v`:

- Tile A: `(Math.fround(v), v − Math.fround(v))`
- Tile B: `(Math.fround(v), v − Math.fround(v))`

Identical inputs to a deterministic split → identical `(hi, lo)` pairs.
Same float32 bits in both tiles' vertex attribute → same shader output →
bit-identical raster coverage → no seam.

### Why this fixes the jitter

The shader does:

```
projected = project_offset_(modelMatrix * pos)  // float32 chain
          + project_offset_(modelMatrix * vec4(pos64Low, 0))  // recovers lost precision
```

The first line has the ~1 m quantization we currently have. The second
line adds back the lost sub-meter detail. End result: float64-equivalent
positions on a float32 GPU.

## Scope of change

Four files. Public API additions: none — fp64 is internal to mesh
construction and the inner mesh-texture layer.

- [`packages/deck.gl-raster/src/raster-layer.ts`](../../packages/deck.gl-raster/src/raster-layer.ts)
  — `_generateMesh` writes positions to a **Float64Array** instead of
  Float32Array. The mesh data structure's `POSITION.value` becomes a
  Float64Array; downstream (`MeshTextureLayer`) hands it to the layer's
  attribute manager which auto-splits.
- [`packages/deck.gl-raster/src/mesh-layer/mesh-layer.ts`](../../packages/deck.gl-raster/src/mesh-layer/mesh-layer.ts)
  — `MeshTextureLayer` overrides `initializeState()` to add a
  `positions64Low` attribute via `attributeManager.add`/`addInstanced`
  with `type: 'float64', fp64: this.use64bitPositions()`. Mirrors
  [`BitmapLayer.initializeState`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/layers/src/bitmap-layer/bitmap-layer.ts#L135-L161).
  Then `getShaders()` returns a `vs` override — a copy of
  [`simple-mesh-layer-vertex.glsl.ts`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer-vertex.glsl.ts)
  with **one substitution**: in the `composeModelMatrix` branch,
  replace the `instancePositions64Low` argument to
  `project_position_to_clipspace` with
  `positions64Low + instancePositions64Low`. Total addition: ~60 lines
  of GLSL we explicitly own, plus the attribute plumbing.
- No changes to [`packages/deck.gl-raster/src/raster-tileset/raster-tileset-2d.ts`](../../packages/deck.gl-raster/src/raster-tileset/raster-tileset-2d.ts).
  No per-tile reference point. No `referencePointMeters` prop on
  `RasterLayer`. No `modelMatrix.translation` per tile. We keep `main`'s
  shape — single shared `coordinateOrigin: [TILE_SIZE / 2, TILE_SIZE / 2, 0]`,
  uniform `modelMatrix = diag(WEB_MERCATOR_TO_WORLD_SCALE)`.
- Test: [`packages/deck.gl-raster/tests/raster-layer.test.ts`](../../packages/deck.gl-raster/tests/raster-layer.test.ts)
  — extend to assert positions are written to a `Float64Array` with full
  float64 precision, and that the value at a sample vertex matches the
  reprojector's exact output to within float64 ULP (not float32 ULP).

## Non-goals

- LNGLAT coordinate system. Cartesian + fp64 mesh positions is the
  closer match to our existing pipeline (we already speak EPSG:3857
  internally).
- Reviving the deprecated `Fp64Extension` (lnglat-only, throws for
  cartesian — see [`fp64-extension.ts`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/extensions/src/fp64/fp64-extension.ts#L10-L18)).
  We use the *attribute-pair* fp64 mechanism (BitmapLayer pattern),
  which is the supported approach.
- The standalone `RasterLayer` (used without `RasterTileLayer`).
  Should inherit the fix automatically since the mesh-attribute change
  is at the `RasterLayer` level.
- Globe mode. Out of scope; revisit alongside globe-projected raster
  work.

## Verification

- Unit test (above) — float64 ULP precision in the stored attribute.
- Manual browser test on the NAIP mosaic example:
  - Pan and zoom around z16–z19 over the continental US. No visible
    jitter relative to the basemap (within ~1 px). No seams between
    adjacent tiles. Both metrics matter — see the "why we tried first"
    section.
  - Compare to `main` at z18+: previously the entire raster shifted
    together by ~1 m; after the fix, raster stays anchored to basemap
    at all zooms.

## Risks

- **Custom vertex shader maintenance.** We own ~60 lines of GLSL that
  duplicate (with a one-line change) upstream's
  `simple-mesh-layer-vertex.glsl.ts`. If deck.gl 10 changes the
  vertex shader interface meaningfully, we adapt. The dependency is
  bounded — we already maintain the fragment shader for the same
  layer.
- **`use64bitPositions()` returning `false`.** Defined on the base
  `Layer` class ([`core/src/lib/layer.ts:357-364`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/lib/layer.ts#L357-L364)),
  it returns `true` for `default`, `lnglat`, or `cartesian`. We
  always set `cartesian` for non-globe tiles in
  [`RasterTileLayer._renderSubLayers`](../../packages/deck.gl-raster/src/raster-tile-layer/raster-tile-layer.ts),
  so the flag is `true`. Worth asserting in a test to catch any future
  silent regression.
- **Vertex stage cost.** fp64 adds ~3–5× cost per arithmetic operation
  in the vertex shader. Our meshes are tiny (dozens to a few hundred
  vertices per tile), so total vertex stage cost stays in the
  microseconds. Fragment work (texture sampling, render pipeline
  modules) dominates total frame time and is unaffected — fp64 is
  vertex-only.
- **Upstream gap.** SimpleMeshLayer itself does not fp64 its primitive
  `positions` attribute (only `instancePositions`). This is a
  documented assumption mismatch with our usage (see
  [`coordinate-systems.md`](../coordinate-systems.md) § "SimpleMeshLayer:
  small-model-big-anchor"). Worth a follow-up issue at
  vis.gl/deck.gl proposing optional fp64 for primitive positions;
  until then we patch locally.

## Follow-ups

- File an upstream issue at vis.gl/deck.gl proposing optional fp64 for
  `SimpleMeshLayer`'s primitive `positions` attribute. If accepted,
  drop our custom vertex shader and rely on a flag.
- Globe-mode precision. Revisit when globe-projected raster ships.
- Standalone (non-tile) `RasterLayer` precision — should be inherited
  for free via the same mesh-level fp64 split; verify when a use case
  surfaces.
