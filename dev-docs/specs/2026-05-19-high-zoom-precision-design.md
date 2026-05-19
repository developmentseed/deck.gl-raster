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
  true float64 vertex value, computed on the CPU as
  `Math.fround(v_f64)`
- `positions64Low` (Float32Array low parts) — the residual
  `v_f64 − Math.fround(v_f64)`, also stored as float32 (it's small enough
  to be exactly representable)

The pair `(hi, lo)` together carries ~14 decimal digits of precision
(float64-equivalent at our magnitudes). deck.gl's vertex projection
shader already accepts both — [`project_position`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/shaderlib/project/project.glsl.ts#L188-L235)
takes a `position64Low` parameter and adds
`project_offset_(modelMatrix * vec4(position64Low, 0.0))` to the
result. The infrastructure is built-in and not deprecated; see
[`coordinate-systems.md`](../coordinate-systems.md) § "fp64 attribute
pairs".

### Wiring: split on CPU, two separate plumbing paths

BitmapLayer gets the fp64 split for free by declaring its `positions`
attribute with `type: 'float64', fp64: true` on `AttributeManager`,
which auto-splits Float64Array into `positions` (high) and
`positions64Low` (low) at upload. That auto-split lives in
AttributeManager — BitmapLayer is AttributeManager-driven for all
attributes (its Model has no Geometry).

SimpleMeshLayer is **Geometry-driven** for mesh primitive attributes:
`positions`, `colors`, `normals`, `texCoords` come from
[`getGeometry(mesh)`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer.ts#L72-L89),
not through AttributeManager. And
[`normalizeGeometryAttributes`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer.ts#L42-L66)
whitelists those four names — any extra attribute keys are silently
dropped. So we can't reach the auto-split mechanism via the mesh prop.

The implementation splits manually on the CPU and plumbs each half via
the path that fits its origin:

- **High part** (Float32Array) → travels through the existing mesh prop
  as `mesh.attributes.POSITION.value`. Geometry path. Becomes
  `in vec3 positions` in the shader. Same shape as today, just narrower
  values.
- **Low part** (Float32Array) → exposed as a new `MeshTextureLayer`
  prop (`positions64Low`). Registered via `attributeManager.add({
  positions64Low: { type: 'float32', size: 3, noAlloc: true,
  update: attr => attr.value = this.props.positions64Low }})`. AttributeManager
  path, non-instanced. The Model's `bufferLayout` (from
  `attributeManager.getBufferLayouts()`) gains the entry, the buffer is
  bound to `in vec3 positions64Low` in the shader.

Both buffers are per-vertex (same vertex count, same indexing), so
they're consumed together in the same draw call.

### Invariant required by the fp64 correction

The SimpleMeshLayer vertex shader builds its working position as:

```glsl
vec3 pos = (instanceModelMatrix * positions) * simpleMesh.sizeScale + instanceTranslation;
```

Our `positions64Low` represents the low part of `positions`, not of
`pos`. The fp64 correction is therefore correct only when:

- `instanceModelMatrix` is identity (no per-instance rotation/scale)
- `simpleMesh.sizeScale` is 1
- `instanceTranslation` is `[0, 0, 0]`
- `_instanced` is `false` and `instancePositions` is `[0, 0, 0]`

That matches `RasterLayer`'s current usage exactly. To prevent silent
breakage if `MeshTextureLayer` is ever wired into a different usage
pattern, the plan should add a development-mode assertion in
`MeshTextureLayer` that these invariants hold.

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

Three source files plus tests. Public API additions: none — fp64
splitting is internal to mesh construction and the inner mesh-texture
layer.

- [`packages/deck.gl-raster/src/raster-layer.ts`](../../packages/deck.gl-raster/src/raster-layer.ts)
  — `_generateMesh` (and its `reprojectorToMesh` helper) splits each
  float64 vertex coordinate from the reprojector into a
  `(Math.fround(v), v − Math.fround(v))` pair. Returns two
  Float32Arrays (high and low). The mesh structure stored in
  `state.mesh` gains a `positions64Low` field alongside the existing
  `attributes.POSITION` (which holds the high part as a Float32Array,
  same type as today). The state-mesh shape:
  ```ts
  state.mesh = {
    indices: { value: Uint32Array, size: 1 },
    attributes: {
      POSITION:   { value: Float32Array /* high */, size: 3 },
      TEXCOORD_0: { value: Float32Array,             size: 2 },
    },
    positions64Low: Float32Array /* low */,
  }
  ```
  `renderLayers` passes both to the inner `MeshTextureLayer`: the
  `mesh` prop as today, plus a new `positions64Low` prop.

- [`packages/deck.gl-raster/src/mesh-layer/mesh-layer.ts`](../../packages/deck.gl-raster/src/mesh-layer/mesh-layer.ts)
  — `MeshTextureLayer` adds:
  1. A new `positions64Low: Float32Array | null` prop (default `null`).
  2. `initializeState()` calls `super.initializeState()`, then
     `attributeManager.add({ positions64Low: { type: 'float32',
     size: 3, noAlloc: true, update: attr => attr.value = this.props.positions64Low }})`.
     Non-instanced, so it's a per-vertex attribute alongside the
     geometry's `positions`.
  3. `updateState` invalidates the `positions64Low` attribute when
     `props.positions64Low` reference changes.
  4. `getShaders()` returns a `vs` override — a copy of upstream
     [`simple-mesh-layer-vertex.glsl.ts`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer-vertex.glsl.ts)
     with one substitution in the `composeModelMatrix` branch: replace
     the `instancePositions64Low` argument to
     `project_position_to_clipspace` with
     `positions64Low + instancePositions64Low`. Also add
     `in vec3 positions64Low;` to the attribute declarations at the
     top. ~60 lines of GLSL total that we explicitly own.
  5. A development-mode assertion in `updateState` that the usage
     invariants hold (`_instanced === false`, `getPosition` resolves
     to `[0,0,0]`, identity model matrix, `sizeScale === 1`). The
     check **throws** when violated — a misused `MeshTextureLayer`
     produces precision-only-wrong output that looks plausibly
     correct, so a loud failure is what catches it. Gated on
     `process.env.NODE_ENV !== 'production'` so it's stripped from
     prod builds. See "Invariant" section above.

- No changes to [`packages/deck.gl-raster/src/raster-tileset/raster-tileset-2d.ts`](../../packages/deck.gl-raster/src/raster-tileset/raster-tileset-2d.ts).
  No per-tile reference point. No `referencePointMeters` prop on
  `RasterLayer`. No `modelMatrix.translation` per tile. We keep `main`'s
  outer shape — single shared `coordinateOrigin: [TILE_SIZE / 2, TILE_SIZE / 2, 0]`,
  uniform `modelMatrix = diag(WEB_MERCATOR_TO_WORLD_SCALE)`. The fp64
  precision improvement is entirely internal to the mesh attribute
  pipeline.

- Tests in [`packages/deck.gl-raster/tests/raster-layer.test.ts`](../../packages/deck.gl-raster/tests/raster-layer.test.ts):
  - `_generateMesh` produces two Float32Arrays (high + low) with the
    same length; each is finite and non-NaN.
  - **Precision claim:** for sample vertices spanning the full 3857
    magnitude range (~±2 × 10⁷ m), `high[i] + low[i]` (computed in
    JS float64 from the stored Float32Array entries) reconstructs
    the reprojector's float64 output to within **float32 ULP at the
    low part's magnitude** — concretely, `< 1e-6 m` absolute error.
    Compare to the current float32-of-input floor of `~1 m` at the
    same magnitude. This bound is the strict claim of the fp64
    attribute-pair encoding and catches any silent regression in
    the split.
  - Regression: the existing mesh state-shape and reference-stability
    tests still pass with the augmented mesh object.

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
- **Usage invariants on `MeshTextureLayer`.** The fp64 correction is
  only valid when the SimpleMeshLayer per-instance transforms are
  identity (see "Invariant" section above). `RasterLayer`'s current
  usage satisfies all of them, but if a future caller wires
  `MeshTextureLayer` differently the silent failure would be
  precision-only — wrong but plausibly-correct-looking output. The
  development-mode assertion is what prevents this from sneaking
  through.
- **Vertex stage cost.** fp64 adds ~3–5× cost per arithmetic operation
  in the vertex shader. Our meshes are tiny (dozens to a few hundred
  vertices per tile), so total vertex stage cost stays in the
  microseconds. Fragment work (texture sampling, render pipeline
  modules) dominates total frame time and is unaffected — fp64 is
  vertex-only.
- **Upstream gap.** SimpleMeshLayer itself does not fp64 its primitive
  `positions` attribute (only `instancePositions`). This is the
  assumption mismatch documented in
  [`coordinate-systems.md`](../coordinate-systems.md) §
  "SimpleMeshLayer: small-model-big-anchor". Worth a follow-up issue
  at vis.gl/deck.gl proposing optional fp64 for primitive positions;
  until then we patch locally.

## Follow-ups

- File an upstream issue at vis.gl/deck.gl proposing optional fp64 for
  `SimpleMeshLayer`'s primitive `positions` attribute. If accepted,
  drop our custom vertex shader and rely on a flag.
- Globe-mode precision. Revisit when globe-projected raster ships.
- Standalone (non-tile) `RasterLayer` precision — should be inherited
  for free via the same mesh-level fp64 split; verify when a use case
  surfaces.
