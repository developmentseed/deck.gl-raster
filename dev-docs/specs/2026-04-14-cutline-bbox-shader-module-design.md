# Cutline Bbox Shader Module Design

## Problem

USGS historical topographic maps — our target dataset for this work, stored as
COGs under `s3://prd-tnm/StagedProducts/Maps/` — include a "map collar" of
metadata (title, legend, publication info, graticule labels) surrounding the
actual cartographic data area. When rendering one or many of these maps via
`COGLayer`, the collar bleeds into the viewport and visually obscures
neighboring data in a mosaic.

Each map ships with WGS84 metadata describing the valid data area as a
`westbc/southbc/eastbc/northbc` bbox from the USGS CSV. For USGS 7.5′ quads this
bbox follows the graticule exactly, so it is always axis-aligned in WGS84 (and
therefore axis-aligned in EPSG:3857 as well, since Web Mercator preserves
lat/lng axis alignment).

We want a reusable way to discard fragments outside such a bbox as part of the
existing shader-module render pipeline used by `COGLayer` / `RasterLayer` /
`MeshTextureLayer`.

## Goals

- Provide a shader module that discards fragments outside a WGS84 axis-aligned
  bbox.
- Integrate with the existing `RasterModule` pipeline (same shape as
  `FilterNoDataVal`, `MaskTexture`).
- Work correctly on `WebMercatorViewport`.
- Let the user opt in via a custom `renderTile` callback on `COGLayer` — do not
  auto-wire into `inferRenderPipeline`.
- Cheap enough to apply on every rendered tile without measurable overhead.

## Non-Goals

- **GlobeView support.** The library does not generally support `GlobeView`
  yet, so this module is scoped to Web Mercator. A comment at the shader
  injection site will note where a globe code path would hook in.
- **Arbitrary polygon cutlines.** If future use cases need non-axis-aligned or
  non-rectangular cutlines (e.g. coastline clipping, general polygons), that is
  a separate module.
- **Antimeridian-crossing bboxes.** USGS quads never cross the antimeridian. The
  module will reject `east <= west`.
- **Multiple cutlines per tile.** One bbox per module instance.
- **Auto-wiring into `inferRenderPipeline`.** The cutline is application-specific
  metadata that `inferRenderPipeline` has no way to know about.
- **Feathered / soft edges.** Hard discard only.

## Design

### Coordinate space for the test

The test lives in **raw EPSG:3857 meters**, *not* in deck.gl's common space.

An earlier design attempt used `position_commonspace` (an existing varying on
the vendored `MeshTextureLayer` fragment shader) against a uniform computed
with `lngLatToWorld` from `@math.gl/web-mercator`. That worked at low zoom but
broke visibly at higher zooms because **deck.gl applies a viewport-dependent
translation to common-space positions** for float32 precision — positions are
rebased to the current viewport anchor before being interpolated across the
mesh. The uniform computed absolutely on the CPU was therefore in a different
coordinate frame than `position_commonspace` in the FS, and at high zoom the
offset grew large enough that every fragment evaluated as "outside" the bbox
and the whole raster was discarded.

The robust approach is to bypass deck.gl common space entirely: capture each
vertex's `positions.xy` attribute (which in `COGLayer`'s mercator path is
already in raw EPSG:3857 meters, by CPU-side construction in
`RasterLayer._generateMesh`) into a new fragment-shader varying via a vertex
shader injection, and compare against a uniform also in raw 3857 meters.
Both sides of the comparison live in the same absolute coordinate frame at
every zoom level, with no viewport-dependent rebasing involved.

The CPU-side WGS84 → 3857 conversion is a hand-rolled spherical mercator
forward (`x = R · λ`, `y = R · ln(tan(π/4 + φ/2))` with `R = 6378137`). We
deliberately do *not* use `lngLatToWorld` here — that function returns values
pre-scaled into deck.gl's 512-unit common-space world, which we are
specifically avoiding.

### Shader module shape

New file: `packages/deck.gl-raster/src/gpu-modules/cutline-bbox.ts`. Structure
mirrors `filter-nodata.ts` and `mask-texture.ts`:

```ts
import type { ShaderModule } from "@luma.gl/shadertools";

const EARTH_RADIUS = 6378137.0;
const MERCATOR_LAT_LIMIT = 85.051129;

export type CutlineBboxProps = {
  /** WGS84 axis-aligned bbox [west, south, east, north] in degrees. */
  bbox: [number, number, number, number];
};

const MODULE_NAME = "cutlineBbox";

const uniformBlock = `\
uniform ${MODULE_NAME}Uniforms {
  vec4 bbox; // [minMercX, minMercY, maxMercX, maxMercY] in EPSG:3857 meters
} ${MODULE_NAME};
`;

function lngLatToMercatorMeters(lng: number, lat: number): [number, number] {
  const x = (EARTH_RADIUS * lng * Math.PI) / 180;
  const y =
    EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

/**
 * Discards fragments whose position falls outside a WGS84 axis-aligned bbox.
 *
 * Only supports rendering in a WebMercatorViewport — the caller is
 * responsible for asserting this. Assumes the layer's mesh `positions`
 * attribute is already in EPSG:3857 meters (true for COGLayer/RasterLayer's
 * mercator path).
 */
export const CutlineBbox = {
  name: MODULE_NAME,
  fs: uniformBlock,
  inject: {
    // Pass raw mercator meters from VS to FS via a module-owned varying.
    // This sidesteps deck.gl's common space — which applies a
    // viewport-dependent precision translation that breaks absolute
    // CPU-computed comparisons at high zoom.
    "vs:#decl": `out vec2 v_cutlineBboxMercator;`,
    "vs:#main-start": /* glsl */ `
      v_cutlineBboxMercator = positions.xy;
    `,
    "fs:#decl": `in vec2 v_cutlineBboxMercator;`,
    // Injects at fs:#main-start (not fs:DECKGL_FILTER_COLOR) because the
    // DECKGL_FILTER_COLOR hook is compiled as a separate function whose body
    // cannot see top-level FS varyings. #main-start splices directly into
    // main() where the varying is in scope.
    //
    // Globe support: GlobeView meshes are in 4326 lng/lat, not 3857 meters.
    // The globe code path would need a different varying and matching
    // uniform layout.
    "fs:#main-start": /* glsl */ `
      {
        if (v_cutlineBboxMercator.x < ${MODULE_NAME}.bbox.x ||
            v_cutlineBboxMercator.x > ${MODULE_NAME}.bbox.z ||
            v_cutlineBboxMercator.y < ${MODULE_NAME}.bbox.y ||
            v_cutlineBboxMercator.y > ${MODULE_NAME}.bbox.w) {
          discard;
        }
      }
    `,
  },
  uniformTypes: {
    bbox: "vec4<f32>",
  },
  getUniforms: (props: Partial<CutlineBboxProps>) => {
    const bbox = props.bbox;
    if (!bbox) return {};
    const [west, south, east, north] = bbox;
    validateBbox(west, south, east, north);
    const [swX, swY] = lngLatToMercatorMeters(west, south);
    const [neX, neY] = lngLatToMercatorMeters(east, north);
    return {
      bbox: [
        Math.min(swX, neX),
        Math.min(swY, neY),
        Math.max(swX, neX),
        Math.max(swY, neY),
      ],
    };
  },
} as const satisfies ShaderModule<CutlineBboxProps>;
```

### Validation

`getUniforms` throws when the bbox is invalid, rather than silently producing
garbage:

- `east <= west` → "bbox must have east > west (antimeridian crossing not supported)"
- `north <= south` → "bbox must have north > south"
- `Math.abs(lat) > 85.051129` on either corner → "bbox latitudes must be within Web Mercator limits"

These are cheap checks run once per draw; they catch obvious caller bugs
without measurable overhead.

### Integration point

The user wires the module into a custom `renderTile` callback on `COGLayer`,
appending it to whatever render pipeline they want. For example:

```ts
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import { CutlineBbox } from "@developmentseed/deck.gl-raster";
import { WebMercatorViewport } from "@deck.gl/core";

// In the app:
if (!(viewport instanceof WebMercatorViewport)) {
  throw new Error("USGS cutline rendering requires WebMercatorViewport");
}

new COGLayer({
  geotiff: "s3://prd-tnm/.../AL_Abbeville_East_303063_1969_24000_geo.tif",
  getTileData: /* default or custom */,
  renderTile: (data) => ({
    image: data.texture,
    renderPipeline: [
      { module: CutlineBbox, props: { bbox: [-85.25, 31.5, -85.125, 31.625] } },
    ],
  }),
});
```

The module is **not** added to `inferRenderPipeline`. It is opt-in.

### Y-axis verification

Both `positions.y` (from `RasterLayer`'s mesh, built from 3857 meters) and
our CPU-side `lngLatToMercatorMeters` use a y-increases-northward convention
(higher latitude → higher y), consistent with `cog-layer.ts`'s CARTESIAN
branch comment "No Y-flip needed: CARTESIAN Y increases upward = northing".
Packing as `[minX, minY, maxX, maxY]` with `Math.min`/`Math.max` makes the
comparison robust to any future sign flip.

### Float32 precision ceiling

Mercator meter values in the continental US sit around |10M|. Float32 has
~7 decimal digits of precision, so at |10M| each float has ~1.2m
quantization. Web Mercator pixel size is ~1.2m at z=16, ~0.6m at z=17,
~0.3m at z=18. This means the bbox edges start quantizing to roughly
1-pixel boundaries around z=17 and produce visible "wiggle" at z=18+. The
interior of a typical USGS quad bbox (~25km × 25km) has tens of thousands
of distinct float32 values, so interior fragments stay correctly inside the
bbox at every zoom — only the edges quantize.

For the target USGS historical topo use case (printed at ~300 DPI, typical
viewing z=11–17) this is acceptable. If a future use case needs sharp edges
at z=18+, the fix is to add a `POSITION64LOW` attribute to `RasterLayer`'s
mesh output and use two-float precision in both the VS injection and the
uniform — a larger change intentionally out of scope for this module.

## Architecture Overview

```
USGS CSV { westbc, southbc, eastbc, northbc }   ← user
         │
         │  (once per module instance, in app code)
         ▼
new COGLayer({ renderTile: data => ({
  renderPipeline: [{ module: CutlineBbox, props: { bbox } }],
  ...
})})
         │
         │  (per draw, on GPU)
         ▼
getUniforms → lngLatToMercatorMeters(west, south),
              lngLatToMercatorMeters(east, north)
         │
         ▼
uniform vec4 cutlineBbox.bbox   (raw EPSG:3857 meters)
         │
         │  VS:  v_cutlineBboxMercator = positions.xy;   (raw 3857 m)
         ▼
fs: compare v_cutlineBboxMercator against bbox → discard if outside
```

## Testing

### Unit tests

New file:
`packages/deck.gl-raster/src/gpu-modules/cutline-bbox.test.ts`. No GPU needed.

- `getUniforms` with a known WGS84 bbox (e.g. `[-85.25, 31.5, -85.125, 31.625]`
  from the Abbeville East USGS quad) produces the expected `vec4`, computed by
  calling `lngLatToWorld` in the test itself.
- `getUniforms` with no `bbox` returns an empty object (no-op pipeline
  behavior).
- `getUniforms` throws on:
  - `east <= west`
  - `north <= south`
  - latitude > 85.051129
  - latitude < -85.051129
- Module metadata: `name` equals `"cutlineBbox"`, `uniformTypes.bbox` equals
  `"vec4<f32>"`, `fs` contains the `cutlineBboxUniforms` declaration.

### Manual visual verification

A new example under `examples/usgs-topo/` (added by the user, not as part of
this spec's implementation) will load one USGS historical COG from the open S3
bucket, wire `CutlineBbox` into a custom `renderTile` callback with the bbox
from the CSV row, and render it in a `DeckGL` + `WebMercatorViewport`. Success
criteria:

- The collar is completely discarded — only the map's data area is visible.
- The edges of the discarded region align with the WGS84 graticule (verified
  by overlaying a basemap).
- Panning/zooming causes no visible flicker or mis-alignment at tile
  boundaries.

## Files Changed

- **new** `packages/deck.gl-raster/src/gpu-modules/cutline-bbox.ts`
- **new** `packages/deck.gl-raster/src/gpu-modules/cutline-bbox.test.ts`
- **edit** `packages/deck.gl-raster/src/gpu-modules/index.ts` — export `CutlineBbox`
  and `CutlineBboxProps`.

No changes to `COGLayer`, `RasterLayer`, `MeshTextureLayer`, or
`inferRenderPipeline`. The example gallery entry is added separately by the
user.
