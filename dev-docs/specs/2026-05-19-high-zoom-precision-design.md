# Fix high-zoom jitter via common-space mesh + fp64 attributes

- **Date:** 2026-05-19 (revised 2026-05-20)
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

## Why deck.gl's auto-offset doesn't fix this on its own

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

## Three independent error sources

Tracing the cartesian + auto-offset shader chain end to end
([`project.glsl.ts`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/shaderlib/project/project.glsl.ts#L188-L235)),
there are **three** places precision is lost — and fp64 attribute pairs
alone only fix the first:

```glsl
position_world = modelMatrix * position;     // (A) scale × ~1.3e7 m → ~114 wu
position_world -= shaderCoordinateOrigin;     // (B) ~114 − ~114
clip = viewProjectionMatrix * commonPosition + projectionCenter;  // (C)
```

1. **Attribute quantization.** `position` (3857 meters, ~10⁷) rounds to
   float32 (~1 m) *before the shader runs*. → fixed by fp64 attribute
   pairs (high + low Float32Arrays).
2. **Scale-multiply rounding (A).** `scale × meters` is a float32
   multiply producing a ~114-magnitude result with its own ~10⁻⁵ wu
   (~1 m) rounding. The fp64 low term adds `scale × low` back but does
   *not* undo the rounding of `scale × high`. → **not fixed by fp64
   alone.**
3. **Auto-offset origin re-quantization (B).** `shaderCoordinateOrigin =
   Math.fround(viewport.center) − coordinateOrigin`. With
   `coordinateOrigin = [256,256,0]`, that is `fround(VC) − 256`, which is
   **re-quantized to float32 on upload** (~10⁻⁵ wu ≈ 1 m). → **not fixed
   by fp64 alone.**

The first revision of this spec proposed fp64 attribute pairs alone and
addressed only (1) — leaving (2) and (3) as a ~1 m floor, indistinguishable
from `main`. The full fix below eliminates all three.

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

## Approach: common-space mesh + identity matrix + zero origin + fp64 pairs

Address all three error sources together. Each addition is necessary; the
combination makes every GPU step either Sterbenz-exact or fp64-correctable:

| Error | Fix |
|---|---|
| (1) attribute quantization | **fp64 attribute pairs** (high + low Float32Arrays) |
| (2) scale-multiply rounding | **project to common space on the CPU + `modelMatrix = identity`** — no scale multiply in the shader |
| (3) origin re-quantization | **`coordinateOrigin = [0,0,0]`** — makes `shaderCoordinateOrigin = Math.fround(viewport.center)`, which is exactly float32 (no upload re-quantization) |

### Why (2) + (3) work — the Sterbenz/fround cancellation

Projecting mesh vertices to **full common space** on the CPU
(`common = meters × WEB_MERCATOR_TO_WORLD_SCALE + TILE_SIZE/2`, in float64)
and passing `modelMatrix = identity` means the shader's `position_world`
is the vertex itself — no multiply, so error (2) vanishes.

Setting `coordinateOrigin = [0,0,0]` makes
`shaderCoordinateOrigin = Math.fround(viewport.center) − 0 =
Math.fround(viewport.center)`, which is *exactly* representable in float32
(it's the output of `Math.fround`), so uploading it as a uniform adds no
quantization — error (3) vanishes. Then `position_world −
shaderCoordinateOrigin` is `(~114) − (~114)` of two nearby float32 values:
by the **Sterbenz lemma** that subtraction is *exact* in float32.

The residual `fround(viewport.center)` rounding (≈ ULP at ~114) doesn't
matter because deck.gl computes `projectionCenter` from the same
`fround(viewport.center)` in float64 and adds it back in clip space (step
C). The `fround` terms **cancel exactly** — but *only* when
`shaderCoordinateOrigin` is exactly `fround(viewport.center)`, which the
`[0,0,0]` origin guarantees and the `[256,256,0]` origin breaks.

This is precisely why deck.gl's LNGLAT path is precise: identity model
matrix (no multiply), `fround`-of-degrees origin (exact float32), fp64
pairs for the attribute. We reproduce that discipline in common space.

### fp64 attribute pairs for (1)

Keep the mesh **bit-identical across adjacent tiles** (so shared boundary
vertices match → no seams) by storing absolute common-space coordinates,
and encode each vertex as an **fp64 split pair**:

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
- **Low part** (Float32Array) → registered as a non-instanced attribute
  via `attributeManager.add({ positions64Low: { type: 'float32',
  size: 3, noAlloc: true }})`, and its buffer is supplied through the
  inner sub-layer's `data.attributes.positions64Low`. deck.gl 9.x
  **removed** the `props.<attributeName>` channel for attribute values
  ([`attribute-manager.ts:196`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/lib/attribute/attribute-manager.ts#L196)) —
  a top-level prop named `positions64Low` triggers a removal warning on
  every render. Passing it via `data: { length: 1, attributes: {
  positions64Low } }` lets the AttributeManager pick the buffer up via
  `setExternalBuffer`. The Model's `bufferLayout` (from
  `attributeManager.getBufferLayouts()`) gains the entry, bound to
  `in vec3 positions64Low` in the shader.

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
pattern, these per-instance props (`_instanced`, `getPosition`,
`getOrientation`, `getScale`, `getTranslation`, `getTransformMatrix`,
`sizeScale`) are **omitted from `MeshTextureLayerProps`** and fixed at
identity in `defaultProps` — so they can't be set to a precision-breaking
value. `MeshTextureLayer` is documented as a specialized single-mesh
layer, not a general 3D-model layer. (An earlier revision used a runtime
`assertFp64Invariants` check gated on `NODE_ENV`; excluding the props at
the type level is cleaner and needs no runtime guard.)

### Why this preserves bit-identity across tiles

For a shared boundary vertex at absolute common-space coordinate `v`
(both tiles project the same physical point to the same common-space
value, since the projection is deterministic and the per-tile reproject
fns are identical):

- Tile A: `(Math.fround(v), v − Math.fround(v))`
- Tile B: `(Math.fround(v), v − Math.fround(v))`

Identical inputs to a deterministic split → identical `(hi, lo)` pairs.
Same float32 bits in both tiles' vertex attribute → same shader output →
bit-identical raster coverage → no seam.

### Why this fixes the jitter

With `modelMatrix = identity` and `coordinateOrigin = [0,0,0]`, the
shader reduces to:

```
position_world = position;                       // identity — no multiply (kills error 2)
position_world -= fround(viewport.center);       // Sterbenz-exact (kills error 3)
commonPosition = project_offset_(position_world)
               + project_offset_(positions64Low) // fp64 low recovers error 1
clip = viewProjectionMatrix * commonPosition + projectionCenter  // fround cancels in float64
```

Every step is exact or fp64-corrected: no multiply rounding (identity
matrix), an exact subtraction (Sterbenz, both operands nearby float32),
the attribute residual restored by the low part, and the `fround`
offset cancelled by `projectionCenter` (computed CPU-side in float64).
End result: float64-equivalent positions on float32 GPU hardware, with
shared boundary vertices bit-identical across tiles.

## Scope of change

Four source files plus tests. Public API additions: none.

- [`packages/deck.gl-raster/src/raster-tile-layer/raster-tile-layer.ts`](../../packages/deck.gl-raster/src/raster-tile-layer/raster-tile-layer.ts)
  — in `_renderSubLayers`, the **non-globe** branch:
  - Wraps `forwardReproject` / `inverseReproject` so output is **full
    common space** instead of 3857 meters:
    `forwardReproject(x, y) = projectTo3857(x, y) · S + TILE_SIZE/2`,
    `inverseReproject(cx, cy) = projectFrom3857((c − TILE_SIZE/2) / S)`,
    where `S = WEB_MERCATOR_TO_WORLD_SCALE`. Because delatin measures
    refinement error in **pixel space** via `inverseReproject` (and
    barycentric interpolation commutes with the affine `· S + t`),
    wrapping both functions consistently leaves the triangulation
    **identical** to today.
  - Sets `modelMatrix = identity` and `coordinateOrigin = [0, 0, 0]`
    (the scale and the `TILE_SIZE/2` offset moved into the reproject
    fns above).
  - **Reference stability:** the wrapped fns must be memoized
    per-descriptor (the descriptor is stable per layer), not recreated
    each render, or `RasterLayer.updateState`'s `reprojectionFnsChanged`
    check fires and regenerates the mesh every frame. `forwardTransform`
    / `inverseTransform` stay per-tile (from tile metadata) as today.

- [`packages/deck.gl-raster/src/fp64.ts`](../../packages/deck.gl-raster/src/fp64.ts)
  — a small `splitFloat64(values: Float64Array): [low, high]` helper that
  vectorizes the `(Math.fround(v), v − Math.fround(v))` split into two
  Float32Arrays. Kept standalone (with its own test) so the operation is
  understandable in isolation and reusable.

- [`packages/deck.gl-raster/src/raster-layer.ts`](../../packages/deck.gl-raster/src/raster-layer.ts)
  — `reprojectorToMesh` assembles the exact float64 positions into a
  `Float64Array` and calls `splitFloat64` to get the high/low Float32
  pair. The state-mesh shape gains a `positions64Low` sibling field:
  ```ts
  state.mesh = {
    indices: { value: Uint32Array, size: 1 },
    attributes: {
      POSITION:   { value: Float32Array /* high */, size: 3 },
      TEXCOORD_0: { value: Float32Array,             size: 2 },
    },
  };
  state.positions64Low = Float32Array; /* low */
  ```
  `renderLayers` passes the low part to `MeshTextureLayer` via the
  inner sub-layer's `data.attributes` (see below) — *not* a top-level
  prop. `reprojectorToMesh` is coordinate-system-agnostic: it splits
  whatever the reprojector emits, so the common-space change lives
  entirely in the wrapped reproject fns, not here.

- [`packages/deck.gl-raster/src/mesh-layer/mesh-layer.ts`](../../packages/deck.gl-raster/src/mesh-layer/mesh-layer.ts)
  — `MeshTextureLayer`:
  1. `initializeState()` calls `super.initializeState()`, then
     `attributeManager.add({ positions64Low: { type: 'float32',
     size: 3, noAlloc: true }})`. Non-instanced, per-vertex. No
     `update` callback — the buffer is supplied externally via
     `data.attributes.positions64Low`.
  2. `getShaders()` returns a `vs` override — a copy of upstream
     [`simple-mesh-layer-vertex.glsl.ts`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer-vertex.glsl.ts)
     with one substitution in the `composeModelMatrix` branch: replace
     the `instancePositions64Low` argument to
     `project_position_to_clipspace` with
     `positions64Low + instancePositions64Low`. Also adds
     `in vec3 positions64Low;` to the attribute declarations. ~60 lines
     of GLSL that we own.
  3. `MeshTextureLayerProps` **omits** the per-instance placement props
     (`_instanced`, `getPosition`, `getOrientation`, `getScale`,
     `getTranslation`, `getTransformMatrix`, `sizeScale`); `defaultProps`
     fixes `_instanced: false` and `getPosition: [0,0,0]` (the rest keep
     SimpleMeshLayer's identity defaults). This makes a precision-breaking
     value unsettable at the type level — no runtime check needed. The
     class doc explains the divergence from `SimpleMeshLayer`.
  - `RasterLayer.renderLayers` passes the buffer via the sub-layer's
    `data: { length: 1, attributes: { positions64Low } }` (mesh and
    `positions64Low` are always produced together by `_generateMesh`).
    deck.gl 9.x removed the `props.<attributeName>` channel;
    `data.attributes` is the supported path.

- No changes to [`packages/deck.gl-raster/src/raster-tileset/raster-tileset-2d.ts`](../../packages/deck.gl-raster/src/raster-tileset/raster-tileset-2d.ts).
  No per-tile reference point, no new tile metadata.

- Tests:
  - [`tests/fp64.test.ts`](../../packages/deck.gl-raster/tests/fp64.test.ts):
    `splitFloat64` returns same-length `[low, high]` Float32Arrays;
    `high` equals `Math.fround(v)`; **precision claim:** for sample
    values across a wide magnitude range, `high[i] + low[i]`
    reconstructs the float64 input to `< 1e-6 m` (vs the ~1 m
    float32-of-input floor), catching any regression in the split.
  - [`tests/raster-layer.test.ts`](../../packages/deck.gl-raster/tests/raster-layer.test.ts):
    `_generateMesh` produces a `positions64Low` Float32Array the same
    length as `POSITION`, and `high + low` reconstructs the
    reprojector output. Existing state-shape and reference-stability
    tests still pass.

## Non-goals

- Switching the inner mesh layer to the `lnglat` coordinate system.
  We stay in cartesian/common space (we already speak EPSG:3857
  internally); the precision discipline above reproduces what the
  LNGLAT path does, without a per-vertex degrees reprojection.
- Reviving the deprecated `Fp64Extension` (lnglat-only, throws for
  cartesian — see [`fp64-extension.ts`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/extensions/src/fp64/fp64-extension.ts#L10-L18)).
  We use the *attribute-pair* fp64 mechanism (BitmapLayer pattern),
  which is the supported approach.
- The standalone `RasterLayer` (used without `RasterTileLayer`).
  The common-space wrapping lives in `RasterTileLayer`; a direct
  `RasterLayer` caller would need to supply common-space reproject fns
  itself to get the fix. Revisit if a use case surfaces.
- Globe mode. Out of scope; the wrapping is in the non-globe branch
  only. Revisit alongside globe-projected raster work.

## Verification

- Unit tests (above) — `splitFloat64` reconstruction precision + mesh wiring.
- Manual browser test on the NAIP mosaic example:
  - Pan and zoom around z16–z19 over the continental US. No visible
    jitter relative to the basemap (within ~1 px). No seams between
    adjacent tiles. Both metrics matter — earlier attempts fixed one
    and broke the other.
  - Compare to `main` at z18+: previously the entire raster shifted
    together by ~1 m as `fround(viewport.center)` snapped; after the
    fix, the raster stays anchored to the basemap at all zooms.
  - Confirm the debug mesh overlay (`debug: true`) still aligns; note
    it does *not* get the fp64 treatment (reads raw
    `exactOutputPositions`), so the overlay mesh itself may jitter at
    extreme zoom even though the raster doesn't.

## Risks

- **Reproject-fn reference stability.** The wrapped common-space
  `forwardReproject` / `inverseReproject` must be memoized per
  descriptor. If recreated each render, `RasterLayer.updateState`'s
  `reprojectionFnsChanged` check fires and regenerates the mesh every
  frame — a silent perf regression. Mitigation: memoize on the layer
  keyed by descriptor; covered by the existing reference-stability test
  in `tests/raster-layer.test.ts`.
- **Sterbenz precondition.** The exact subtraction
  `position_world − fround(viewport.center)` relies on the two operands
  being within 2× of each other (Sterbenz). True for on-screen content
  (positions cluster near the viewport center). Worst case is content
  far off-screen or at very low zoom, where (a) Sterbenz may not hold
  and (b) one float32 ULP doesn't matter anyway (low zoom → huge
  pixels). No correctness impact in the regime we care about, but worth
  a sanity check near the antimeridian.
- **Custom vertex shader maintenance.** We own ~60 lines of GLSL that
  duplicate (with a one-line change) upstream's
  `simple-mesh-layer-vertex.glsl.ts`. If deck.gl 10 changes the
  vertex shader interface meaningfully, we adapt. The dependency is
  bounded — we already maintain the fragment shader for the same
  layer.
- **Usage invariants on `MeshTextureLayer`.** The fp64 correction is
  only valid when the SimpleMeshLayer per-instance transforms are
  identity (see "Invariant" section above). A non-identity value would
  silently produce precision-only-wrong output. Mitigation: those props
  are omitted from `MeshTextureLayerProps` and fixed in `defaultProps`,
  so they can't be set — the failure mode is unreachable through the
  public type rather than caught at runtime.
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
