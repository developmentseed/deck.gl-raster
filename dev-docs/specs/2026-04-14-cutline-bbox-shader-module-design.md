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

The test lives in **deck.gl's Web Mercator common space**. This is deck.gl's
universal common space for any layer rendered in a `MapView`: 512 common units
span the Earth's circumference, and a given lat/lng maps to the same
common-space position regardless of what layer's `coordinateSystem` produced
it. In `COGLayer`'s mercator path, mesh positions are supplied in EPSG:3857
meters and scaled into common space via `modelMatrix` + `coordinateOrigin` (see
`cog-layer.ts` `_renderSubLayers`). As a result, the existing
`position_commonspace` varying in `MeshTextureLayer`'s vendored fragment shader
(`mesh-layer-fragment.glsl.ts`) already carries each fragment's position in
deck.gl common space.

The CPU-side conversion from WGS84 to common space uses
`lngLatToWorld` from `@math.gl/web-mercator` — already a transitive dependency
via deck.gl. This is the same function `WebMercatorViewport.projectFlat` wraps
internally, so it produces values consistent with the universal common-space
projection.

### Shader module shape

New file: `packages/deck.gl-raster/src/gpu-modules/cutline-bbox.ts`. Structure
mirrors `filter-nodata.ts` and `mask-texture.ts`:

```ts
import { lngLatToWorld } from "@math.gl/web-mercator";
import type { ShaderModule } from "@luma.gl/shadertools";

export type CutlineBboxProps = {
  /** WGS84 axis-aligned bbox [west, south, east, north] in degrees. */
  bbox: [number, number, number, number];
};

const MODULE_NAME = "cutlineBbox";

const uniformBlock = `\
uniform ${MODULE_NAME}Uniforms {
  vec4 bbox; // [westCommon, southCommon, eastCommon, northCommon]
} ${MODULE_NAME};
`;

/**
 * Discards fragments whose position falls outside a WGS84 axis-aligned bbox.
 *
 * Intended for rendering rasters with a "map collar" (e.g. USGS historical
 * topographic maps) where the valid data area is described as a lat/lng bbox
 * but the raw pixels include surrounding metadata. Only supports rendering in
 * a WebMercatorViewport — the caller is responsible for asserting this.
 */
export const CutlineBbox = {
  name: MODULE_NAME,
  fs: uniformBlock,
  inject: {
    // Injects at fs:#main-start (not fs:DECKGL_FILTER_COLOR). The
    // DECKGL_FILTER_COLOR hook is a generated function whose body only sees
    // its parameters and top-level uniforms; the position_commonspace varying
    // declared in the main FS source is assembled *after* the hook function
    // and is therefore out of scope there. Injecting at #main-start puts the
    // test inside main() where the varying is visible and discard works.
    //
    // Globe support: when rendering in a GlobeView, the mesh positions are in
    // 4326 lng/lat rather than 3857 meters, so position_commonspace is no
    // longer directly comparable to a 3857-meter bbox. A future globe code
    // path would need a different varying and matching uniform layout.
    "fs:#main-start": /* glsl */ `
      {
        vec2 cutlineBboxPos = position_commonspace.xy;
        if (cutlineBboxPos.x < ${MODULE_NAME}.bbox.x ||
            cutlineBboxPos.x > ${MODULE_NAME}.bbox.z ||
            cutlineBboxPos.y < ${MODULE_NAME}.bbox.y ||
            cutlineBboxPos.y > ${MODULE_NAME}.bbox.w) {
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
    const [wCommon, sCommon] = lngLatToWorld([west, south]);
    const [eCommon, nCommon] = lngLatToWorld([east, north]);
    return {
      bbox: [wCommon, sCommon, eCommon, nCommon],
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

`COGLayer`'s comment at `cog-layer.ts` (CARTESIAN branch) says "No Y-flip
needed: CARTESIAN Y increases upward = northing". `lngLatToWorld` also returns
`y` increasing northward (higher latitude → higher `y`). These should agree, so
the test `p.y < south_common || p.y > north_common` is straightforward. If
visual verification shows the test is inverted (cutline rendered upside down),
the fix is swapping the comparison — flagged here as an implementation-time
sanity check, not a likely issue.

### Precision translation note

deck.gl applies a viewport-dependent translation to common-space positions
inside `project_common_position_to_clipspace` (for `gl_Position`) to work
around f32 precision. The `position_commonspace` varying passed into the
vendored `simple-mesh-layer-fs` shader is the pre-clipspace value — i.e.
absolute common space, not the precision-shifted value. The uniform produced by
`lngLatToWorld` is in the same absolute common space, so direct comparison is
valid.

If during implementation this assumption proves wrong (e.g. visible tile
drift), the fix is either (a) apply the same precision translation to the
uniform via `project_uCoordinateOrigin` / `project_uCommonUnitsPerMeter`, or
(b) fall back to a vertex-shader injection that writes a new varying from
`positions.xy`. Flagged here as a verification step.

## Architecture Overview

```
USGS CSV { westbc, southbc, eastbc, northbc }   ← user
         │
         │  (once per module instance, in app code)
         ▼
new CogLayer({ renderTile: data => ({
  renderPipeline: [{ module: CutlineBbox, props: { bbox } }],
  ...
})})
         │
         │  (per draw, on GPU)
         ▼
getUniforms → lngLatToWorld([west, south]), lngLatToWorld([east, north])
         │
         ▼
uniform vec4 cutlineBbox.bbox        (deck.gl common space)
         │
         ▼
fs: compare position_commonspace.xy against bbox → discard if outside
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
