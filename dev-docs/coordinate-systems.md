# Coordinate systems and precision in deck.gl

> Source references in this doc are commit-pinned GitHub permalinks (mostly
> [`visgl/deck.gl@82a02831`](https://github.com/visgl/deck.gl/tree/82a028314b8b20275c8f58713e68702407f2eba4),
> deck.gl 9.3.x), so the linked line numbers are stable. The prose also
> explains each mechanism so you can re-locate it if upstream refactors.

This is the running notebook of everything we've learned the hard way
about how deck.gl handles position precision and projection — the kind of
detail that's not in the public docs but that completely determines
whether high-zoom raster tiles render cleanly. Add to it whenever you
hit a new gotcha.

## TL;DR

- deck.gl renders in a "common space" where the whole world is `[0, 512]`
  in each axis (`TILE_SIZE = 512`).
- Above zoom 12, deck.gl switches to "auto-offset" mode: the high-precision
  part of the position chain stays in JS float64; only the small
  camera-relative remainder is shipped to the GPU as a float32 uniform.
- Auto-offset works *if* per-vertex position attributes are also small
  magnitude (e.g. LNGLAT degrees ≤ 180). It does *not* save you if you
  upload large-magnitude floats (e.g. EPSG:3857 meters at 10⁷).
- The supported high-precision attribute mechanism is **fp64 attribute
  pairs**: store positions as `(hi, lo)` float32 pairs. Every standard
  primitive layer in `@deck.gl/layers` uses this for cartesian and
  lnglat — `SimpleMeshLayer` is a notable exception, only fp64-ing its
  *instance* positions.
- [`Fp64Extension`](https://github.com/visgl/deck.gl/blob/48760d53efae9a94775a0f55e6869478ee223823/modules/extensions/src/fp64/fp64-extension.ts#L10-L29) is a *different* (older) thing — deprecated, lnglat-only,
  and incompatible with `SimpleMeshLayer`. Don't reach for it.

## Coordinate systems

The `coordinateSystem` prop ([`COORDINATE_SYSTEM` in `lib/constants.ts:24-55`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/lib/constants.ts#L24-L55))
controls how deck.gl interprets the position attribute on a layer.

| Value | Position attribute is | `coordinateOrigin` is | Notes |
|---|---|---|---|
| `lnglat` (default for geospatial) | `[lng, lat, alt]` | `[0, 0, 0]` (ignored) | Auto-offset kicks in at z ≥ 12; subtracts `coordinateOrigin` (set to viewport center on CPU) on the GPU. |
| `cartesian` | common-space units, *or* whatever your `modelMatrix` maps to common space | `[0, 0, 0]` or per-layer | Auto-offset path also exists; see "Auto-offset" below. |
| `meter-offsets` | meters from a lng/lat anchor (true ground meters, applied via `addMetersToLngLat`) | `[lng, lat, alt]` anchor | Does *not* match EPSG:3857 distortion at high latitudes. |
| `lnglat-offsets` | small lng/lat deltas | `[lng, lat, alt]` anchor | Like `meter-offsets` but in degrees. |
| `identity` (non-geospatial default) | pixel-space coords | `[0, 0, 0]` | For non-geospatial views; no Mercator math. |

We use `coordinateSystem: 'cartesian'` for non-globe raster tiles and
set up a `modelMatrix` to convert EPSG:3857 meters → common space. We
do not currently support globe mode.

## Common space and `WEB_MERCATOR_TO_WORLD_SCALE`

deck.gl's common space is the *whole world* sized to `[0, 512] × [0, 512]`.
Web Mercator circumference is `40_075_016.686` m. Our conversion factor
is `TILE_SIZE / WEB_MERCATOR_METER_CIRCUMFERENCE = 512 / 40_075_016.686`
≈ `1.278 × 10⁻⁵` common units per 3857 meter
([`packages/deck.gl-raster/src/raster-tile-layer/constants.ts`](../packages/deck.gl-raster/src/raster-tile-layer/constants.ts)).

The Mercator (0, 0) point is at common-space `(256, 256, 0)` — that's
why we set
`coordinateOrigin: [TILE_SIZE / 2, TILE_SIZE / 2, 0]` for the cartesian path.

## `WEB_MERCATOR_AUTO_OFFSET`

[`Viewport.projectionMode`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/viewports/viewport.ts#L205-L212)
returns `WEB_MERCATOR_AUTO_OFFSET` whenever `viewport.isGeospatial && zoom ≥ 12`.
Below z12 it's plain `WEB_MERCATOR`.

In auto-offset mode the CPU computes
([`viewport-uniforms.ts:80-98`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/shaderlib/project/viewport-uniforms.ts#L80-L98)):

```ts
shaderCoordinateOrigin = [Math.fround(viewport.center[0]),
                         Math.fround(viewport.center[1]),
                         0];
// then for cartesian:
shaderCoordinateOrigin[0] -= coordinateOrigin[0];
shaderCoordinateOrigin[1] -= coordinateOrigin[1];
```

That subtraction happens in float64 JS — the CPU produces a small
camera-relative remainder, only the small value is uploaded as a
float32 uniform. The shader then subtracts that uniform from the
projected vertex
([`project.glsl.ts:225-231`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/shaderlib/project/project.glsl.ts#L225-L231)):

```glsl
if (projectionMode == AUTO_OFFSET && coordinateSystem == CARTESIAN) {
  position_world.xyz -= project.coordinateOrigin;  // shaderCoordinateOrigin
}
```

### Gotcha: `Math.fround(viewport.center)` is a precision floor for cartesian

`Math.fround` quantizes the viewport center to float32 *before* the
subtraction. For a typical viewport over the continental US,
`viewport.center` is around `(82, 313, 0)` in common space — float32
ULP at magnitude 80–400 is ~10⁻⁵ to 5×10⁻⁵ common units, i.e. **~few
pixels at z17+**. As you pan smoothly, `fround(viewport.center)` snaps
discretely; the whole scene jumps by 1 ULP. On `main`'s rendering this
manifests as the global ~1 m jitter we live with.

The LNGLAT path doesn't have this floor because `Math.fround` is
applied to lng/lat degrees (small magnitudes), where ULP is sub-cm.

## fp64 attribute pairs

The supported, non-deprecated mechanism for sub-float32 precision in
per-vertex attributes. The pattern, from
[`BitmapLayer.initializeState`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/layers/src/bitmap-layer/bitmap-layer.ts#L141-L160):

```ts
attributeManager.add({
  positions: {
    size: 3,
    type: 'float64',
    fp64: this.use64bitPositions(),
    update: attribute => (attribute.value = this.state.mesh.positions),
    noAlloc
  },
  ...
});
```

When `type: 'float64'` + `fp64: true`, the AttributeManager stores the
data as a `Float64Array` internally and **automatically uploads it as
two Float32 attributes**: `positions` (the float32 nearest each value)
and `positions64Low` (the residual, also as float32). The vertex
shader picks up both:

```glsl
in vec3 positions;
in vec3 positions64Low;

gl_Position = project_position_to_clipspace(
  positions, positions64Low, vec3(0.0), geometry.position
);
```

`project_position_to_clipspace` already accepts the low part and feeds
it through `project_position` ([`project.glsl.ts:188-234`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/shaderlib/project/project.glsl.ts#L188-L234)):

```glsl
return project_offset_(position_world)
     + project_offset_(project.modelMatrix * vec4(position64Low, 0.0));
```

The second term recovers the precision the first lost.

### `Layer.use64bitPositions()`

[`core/src/lib/layer.ts:357-364`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/lib/layer.ts#L357-L364):

```ts
use64bitPositions(): boolean {
  const {coordinateSystem} = this.props;
  return (
    coordinateSystem === 'default' ||
    coordinateSystem === 'lnglat' ||
    coordinateSystem === 'cartesian'
  );
}
```

Returns `true` for `cartesian` — fp64 is *not* lnglat-exclusive. Every
standard primitive layer (`BitmapLayer`, `PathLayer`, `LineLayer`,
`ScatterplotLayer`, `SolidPolygonLayer`, `ColumnLayer`,
`TextBackgroundLayer`) calls this and threads the result into their
`positions` attribute.

### Gotcha: `Fp64Extension` is a different, deprecated thing

[`modules/extensions/src/fp64/fp64-extension.ts`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/extensions/src/fp64/fp64-extension.ts#L10-L18)
is marked `@deprecated`, and **throws** if `coordinateSystem !== 'lnglat'`.
Different mechanism from the attribute-pair approach: it did *full
projection math* in fp64-emulated GLSL via a `project64` shader
module. Don't confuse "fp64 attribute pairs" (the supported, modern
way) with `Fp64Extension` (the deprecated wrapper).

## SimpleMeshLayer: the "small model at big anchor" assumption

[`SimpleMeshLayer`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer.ts#L248-L267)'s
`initializeState` wires fp64 *only* for `instancePositions` — the
per-instance anchor. The mesh primitive `positions` attribute is
plain float32. The implicit assumption: you have a small 3D model
(~meters or tens of meters, model-space coords) instanced at many
big-magnitude lat/lng anchors. Precision-critical data is the anchors,
not the mesh.

We hit this assumption directly. Our case is the opposite: one
mesh per tile at instance `[0, 0, 0]`, with the mesh itself covering
a real geographic extent in absolute meters (millions of meters
magnitude). Float32 mesh attributes don't cut it; the assumption
mismatch is what motivates our local override in
[`MeshTextureLayer`](../packages/deck.gl-raster/src/mesh-layer/mesh-layer.ts)
and the spec at
[`dev-docs/specs/2026-05-19-high-zoom-precision-design.md`](specs/2026-05-19-high-zoom-precision-design.md).

There's also a closely related gotcha: `SimpleMeshLayer`'s vertex
shader has two paths gated by a `composeModelMatrix` uniform
([`simple-mesh-layer-vertex.glsl.ts:42-59`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer-vertex.glsl.ts#L42-L59)).
The flag is set by
[`shouldComposeModelMatrix(viewport, coordinateSystem)`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/mesh-layers/src/utils/matrix.ts#L161-L167),
which returns `true` for `cartesian` or `meter-offsets`. For our
non-instanced cartesian usage, the `composeModelMatrix=true` branch
runs, which calls `project_position_to_clipspace(pos + instancePositions, instancePositions64Low, vec3(0.0), ...)` —
critically passing `instancePositions64Low`, *not* a low part for
the mesh primitive vertex.

## Adjacent-tile boundary alignment

The thing we learned the hard way is that **per-tile mesh encoding of a
shared boundary causes seams, even when the precision math works
out**. Even if the per-tile arithmetic is sub-pixel correct in float64
or in fp64-emulated float32, the GPU rasterizer's coverage rounding
amplifies sub-pixel disagreements at exact pixel boundaries into
1-pixel visible seams.

The mechanism:

- Tile A's right-edge vertex and tile B's left-edge vertex represent
  the same physical 3857 coordinate, but in a per-tile-offset scheme
  they store different attribute values (e.g. `+305` vs `−305`).
- Both go through the float32 instruction chain in the vertex shader:
  `scale × 305 + tx_A` vs. `scale × −305 + tx_B`.
- These are mathematically equal in float64 but accumulate float32
  rounding differently. The disagreement is sub-pixel
  (~10⁻⁹ common units, ~10⁻⁵ pixels at z17).
- If one rounds to sub-pixel position 100.4999 and the other to
  100.5001, the rasterizer covers different pixel columns →
  visible 1-pixel seam.

The **fix** is to encode shared boundary vertices with **bit-identical**
attribute values across adjacent tiles. The way to do that without
losing precision is fp64 attribute pairs on **absolute** coordinates:
same `v` in both tiles → same `(Math.fround(v), v − Math.fround(v))`
pair → same bits in the attribute buffer → bit-identical shader
output. See the spec.

### Where the per-tile shift lives doesn't matter

We tried three places for the per-tile shift in earlier iterations:

1. `modelMatrix.translation` — float32 uniform at ~166 magnitude in
   common units. ULP ~10⁻⁵, ~1 m on the ground. Fails precision.
2. `coordinateOrigin` (per tile, at tile origin magnitude) — auto-offset
   makes the resulting uniform small, so precision is fine. But each
   tile's uniform is different, and the per-tile-different mesh attribute
   values cause the seam mechanism above.
3. `coordinateOrigin` shared across tiles (set to `viewport.center`),
   per-tile shift in `modelMatrix.translation` (camera-relative, small).
   Same seam mechanism as (2) — the mesh attributes are still per-tile,
   the shift just lives in different uniforms.

All three create seams. The fix is structural — keep the mesh
encoding identical across adjacent tiles (absolute coords) and add
precision via fp64 attribute splits.

## High-zoom precision: three error sources, and why fp64 alone isn't enough

When we first applied fp64 attribute pairs (above), the jitter at z16+
did *not* go away. The reason: there are **three** independent
float32-at-large-magnitude error sources in the cartesian + auto-offset
shader chain, and fp64 attribute pairs only fix the first.

Tracing [`project.glsl.ts:188-235`](https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/core/src/shaderlib/project/project.glsl.ts#L188-L235):

```glsl
position_world = modelMatrix * position;     // (A) scale × ~1.3e7 m → ~114 wu
position_world -= shaderCoordinateOrigin;     // (B) ~114 − ~114
clip = viewProjectionMatrix * commonPosition + projectionCenter;  // (C)
```

1. **Attribute quantization** — the input position (3857 meters, ~10⁷)
   rounds to float32 (~1 m) before the shader. Fixed by fp64 attribute
   pairs.
2. **Scale-multiply rounding (A)** — `scale × meters` is a float32
   multiply with its own ~10⁻⁵ wu (~1 m) rounding at the ~114 result
   magnitude. The fp64 low term adds `scale × low` but doesn't undo the
   rounding of `scale × high`.
3. **Origin re-quantization (B)** — `shaderCoordinateOrigin =
   Math.fround(viewport.center) − coordinateOrigin`. With
   `coordinateOrigin = [256,256,0]`, that's `fround(VC) − 256`, *re*-rounded
   to float32 on upload (~10⁻⁵ wu ≈ 1 m).

### The fix: project to common space, identity matrix, zero origin

Eliminate (2) and (3) so fp64 (which fixes (1)) is the only correction
needed:

- **Project mesh vertices to full common space on the CPU**
  (`common = meters × WEB_MERCATOR_TO_WORLD_SCALE + TILE_SIZE/2`, float64)
  and pass `modelMatrix = identity`. The shader's `position_world` is
  then the vertex itself — no multiply, no (2).
- **Set `coordinateOrigin = [0,0,0]`.** Then
  `shaderCoordinateOrigin = Math.fround(viewport.center)`, which is
  *exactly* float32 (it's the output of `Math.fround`) — no upload
  re-quantization, no (3). And `position_world − shaderCoordinateOrigin`
  is `(~114) − (~114)` of two nearby float32 values, which is **exact**
  by the **Sterbenz lemma** (`a − b` is exact when `a/2 ≤ b ≤ 2a`).

The residual `fround(viewport.center)` rounding cancels: deck.gl computes
`projectionCenter` from the *same* `fround(viewport.center)` in float64
and adds it back in clip space (step C). The cancellation is exact *only*
when `shaderCoordinateOrigin` is exactly `fround(viewport.center)` — which
`[0,0,0]` guarantees and `[256,256,0]` breaks (the `−256` forces a
re-rounding that no longer matches `projectionCenter`).

This is the same precision discipline deck.gl's **LNGLAT** path already
follows: identity model matrix (no multiply), `fround`-of-degrees origin
(exact float32), fp64 pairs for the attribute. We reproduce it in
cartesian/common space rather than converting to lng/lat.

### Why delatin's triangulation is unaffected by the common-space move

We apply the `× scale + offset` by wrapping the `forwardReproject` /
`inverseReproject` functions, *not* inside the reprojector. Delatin
measures refinement error in **pixel space** (it inverse-projects the
interpolated output back to pixels and compares). Barycentric
interpolation commutes with an affine transform
(`interp(f(a),f(b),f(c)) = f(interp(a,b,c))` when weights sum to 1), and
`inverseReproject` undoes the affine before going to pixels — so as long
as *both* fns are wrapped consistently, the pixel-space error, and thus
the triangulation, is identical to 3857-meter output.

## Performance: fp64 cost is vertex-only

fp64-emulated arithmetic is ~3–5× slower per operation than float32,
but **only in the vertex shader**. Once vertices land in clip space,
the rasterizer interpolates UVs in float32 (it always does), and the
fragment shader reads textures with those float32 UVs. **Texture
sampling is unaffected.**

Vertex cost for our use case: tens to hundreds of vertices per tile,
dozens of tiles in flight — microseconds total per frame. Fragment work
(texture sampling × raster pipeline modules × millions of fragments)
dominates by orders of magnitude. fp64 vertex math is essentially free
for us.

## See also

- [`dev-docs/specs/2026-05-19-high-zoom-precision-design.md`](specs/2026-05-19-high-zoom-precision-design.md)
  — the high-zoom jitter fix using fp64 mesh attributes
- [`dev-docs/texture-alignment.md`](texture-alignment.md) —
  luma.gl-side texture layout notes
- [`dev-docs/lod-and-pixel-matching.md`](lod-and-pixel-matching.md) —
  pixel-ratio handling in tile selection
- [`dev-docs/zoom-terminology.md`](zoom-terminology.md) — what "zoom"
  means at each layer
