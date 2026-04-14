# UV Crop for COGLayer Edge Tiles

## Problem

After switching [`COGLayer`](../../packages/deck.gl-geotiff/src/cog-layer.ts) to `boundless: true` in [f70a979](../../packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts) (part of the deck.gl/luma.gl 9.3 upgrade), edge tiles now render the zero-padded region outside the valid pixel footprint. The NAIP example is the reproducer: the COG's only tile is a 512×512 block with 302×387 of valid pixels, and the 210×125 padded remainder is visible as black/garbage. COGs that declare `nodata` or a mask IFD get cleaned up by existing pipeline modules, but many COGs (including NAIP) do not, and the padding shows through.

We switched to `boundless: true` deliberately — see [`dev-docs/boundless-tiles.md`](../boundless-tiles.md) and [`dev-docs/texture-alignment.md`](../texture-alignment.md). Uniform nominal tile sizes simplify the tile-affine / mesh relationship and avoid the odd-width row-alignment class of luma.gl bug. We don't want to go back.

The MultiCOGLayer shader module [`CompositeBands`](../../packages/deck.gl-raster/src/gpu-modules/composite-bands.ts) already has a `uvTransform` uniform, but that's a different concept — it maps primary-tile UV into a sub-rect of a stitched / lower-resolution secondary texture. Reusing the name here would conflate cropping with resolution/stitching.

## Goals

- Fix the NAIP edge-tile rendering regression without reverting `boundless: true` or touching `RasterLayer` / mesh generation.
- Establish a reusable shader-discard pattern that future work (polygon cutlines for USGS historical topo maps) can extend.
- Keep the hot path — fully interior tiles — unchanged.

## Non-Goals

- **MultiCOGLayer edge tiles.** It has a different rendering pipeline (`CompositeBands`) and may have a similar issue; handled as a follow-up, not here.
- **Polygon / cutline masking.** Needed for topo maps with non-rectangular neatlines. Explicitly deferred; this design leaves room for a separate `CutlinePolygon` module that coexists with `UvCrop`.
- **Arbitrary mesh clipping.** Custom starting triangulations for `RasterLayer` may eventually be needed for antialiased cutlines, but not for this fix.
- **`boundless: false` fallback.** We're committing to nominal-size textures for COGLayer.

## Design

### 1. New shader module: `UvCrop`

Lives in [`packages/deck.gl-raster/src/gpu-modules/uv-crop.ts`](../../packages/deck.gl-raster/src/gpu-modules/), exported from [`gpu-modules/index.ts`](../../packages/deck.gl-raster/src/gpu-modules/index.ts) alongside `FilterNoDataVal` / `MaskTexture`. Structure mirrors `FilterNoDataVal`: a single uniform block, single `discard` injected into `fs:DECKGL_FILTER_COLOR`.

```ts
export type UvCropProps = {
  /** [offsetX, offsetY, sizeX, sizeY] in UV units [0, 1]. */
  uvCrop: [number, number, number, number];
};

const MODULE_NAME = "uvCrop";

const uniformBlock = `\
uniform ${MODULE_NAME}Uniforms {
  vec4 rect;
} ${MODULE_NAME};
`;

export const UvCrop = {
  name: MODULE_NAME,
  fs: uniformBlock,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
    if (geometry.uv.x < ${MODULE_NAME}.rect.x ||
        geometry.uv.x >= ${MODULE_NAME}.rect.x + ${MODULE_NAME}.rect.z ||
        geometry.uv.y < ${MODULE_NAME}.rect.y ||
        geometry.uv.y >= ${MODULE_NAME}.rect.y + ${MODULE_NAME}.rect.w) {
      discard;
    }
    `,
  },
  uniformTypes: {
    rect: "vec4<f32>",
  },
  getUniforms: (props: Partial<UvCropProps>) => ({
    rect: props.uvCrop ?? [0, 0, 1, 1],
  }),
} as const satisfies ShaderModule<UvCropProps>;
```

**UV convention.** `geometry.uv` in the raster mesh is the tile-local UV in `[0, 1]²` of the full nominal tile (the texCoords produced by `RasterReprojector`, normalized against the `width + 1` / `height + 1` grid). `uvCrop = [0, 0, validW/tileW, validH/tileH]` gives the axis-aligned sub-rect of valid pixels anchored at the origin. The module does not need to know about texture dimensions.

**Half-open interval.** The crop rect is `[offsetX, offsetX + sizeX) × [offsetY, offsetY + sizeY)`. The upper-bound comparison is `>=`, not `>`, so that `uvCrop.z = validW / tileW` discards fragments that would nearest-sample pixel `validW` (the first invalid column). With strict `>` and `validW = 302`, `tileW = 512`, fragments at exactly `uv.x = 302/512` would sample pixel 302 (invalid). Using `>=` avoids that off-by-one.

**Module ordering.** Inserted early in the pipeline — immediately after `CreateTexture`, before `FilterNoDataVal` / `MaskTexture` / photometric-to-RGB conversion — so `discard` short-circuits the downstream work for invalid fragments.

### 2. COGLayer integration

All changes in [`packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts`](../../packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts).

**Extend `TextureDataT`:**

```ts
export type TextureDataT = {
  height: number;
  width: number;
  byteLength: number;
  texture: Texture;
  mask?: Texture;
  /** Present only when the tile's valid region is smaller than the nominal tile size. */
  uvCrop?: [number, number, number, number];
};
```

**In `getTileData` (`createUnormPipeline`):** after fetching the tile, compute the valid region from the `image` (which is a `GeoTIFF` or `Overview` — both expose `width`, `height`, `tileWidth`, `tileHeight`):

```ts
const validW = Math.min(image.tileWidth, image.width - x * image.tileWidth);
const validH = Math.min(image.tileHeight, image.height - y * image.tileHeight);
const uvCrop: TextureDataT["uvCrop"] =
  validW < image.tileWidth || validH < image.tileHeight
    ? [0, 0, validW / image.tileWidth, validH / image.tileHeight]
    : undefined;
```

Return `uvCrop` as part of `TextureDataT`.

**In `renderTile` (pipeline construction):** the existing code builds the pipeline array once per `inferRenderPipeline` call. We need the `UvCrop` module's inclusion to be per-tile, because interior tiles should skip it. Two options:

1. **Resolve-time conditional** — keep one pipeline array with `UvCrop` always present, but make its `uvCrop` prop a function `(data) => data.uvCrop ?? [0, 0, 1, 1]`. Interior tiles run the `discard` check with a no-op rect.
2. **Per-tile pipeline construction** — `renderTile` builds a fresh array per call, appending `UvCrop` only when `data.uvCrop !== undefined`.

We prefer **(2)**: interior tiles (the common case) pay zero shader cost, which matches the "only include when needed" decision. `renderTile` in the current code already does a per-call `.map(...)` through `resolveModule`, so building a fresh array per call is not a new cost. The inclusion check is one `undefined` test per tile.

**Module position:** insert `UvCrop` at index 1 (directly after `CreateTexture`).

### 3. Relationship to future cutlines

The design leaves the door open for polygon cutlines without needing to rework this module:

- `UvCrop` handles the axis-aligned per-tile rectangular case.
- A future `CutlinePolygon` (or `PolygonMask`) module lives alongside, operates on `geometry.uv` the same way, and discards fragments outside a polygon. It can coexist with `UvCrop` in the same pipeline — multiple `discard`s compose naturally.
- The polygon cutline is per-image, not per-tile, so its plumbing is different: the image's cutline is defined once per COG and each tile needs to project it into tile UV space (`pixelInImage = pixelInTile + [x * tileW, y * tileH]`). That's a separate design.
- If antialiasing at the cutline edge becomes a concern, the solution is custom triangulation in `RasterLayer`, which is independent of and compatible with this discard-based approach.

## Testing

- **Unit test: `UvCrop` module shape.** Follow the pattern in [`tests/gpu-modules/`](../../packages/deck.gl-raster/tests/gpu-modules/) — assert name, `uniformTypes`, `getUniforms` default, and inject points.
- **Unit test: pipeline inclusion.** Extend [`packages/deck.gl-geotiff/tests/render-pipeline.test.ts`](../../packages/deck.gl-geotiff/tests/render-pipeline.test.ts):
  - Interior tile (`uvCrop === undefined`) → pipeline has no `uv-crop` module.
  - Edge tile (`uvCrop !== undefined`) → pipeline contains `uv-crop` at index 1, with the expected `uvCrop` prop.
  - Fixture: reuse an existing COG; mock `MOCK_RENDER_TILE_DATA` with and without `uvCrop` set.
- **Valid-region math.** A small unit test covering `validW = min(tileW, imageW - x*tileW)` for a few corner cases (last column, last row, fully interior, single-tile image smaller than one block — the NAIP case).
- **Visual verification.** Manual check on:
  - NAIP example (`examples/naip-mosaic`) — the current repro. The padded remainder should vanish.
  - `cog-basic` Anderson Co. COG — edge tiles with odd widths, which were the original alignment-bug repro. Should continue to render correctly.
  - Any non-edge interior tile — no visible regression, no new seams.

## Open Questions

None blocking.

## Follow-ups (out of this change)

- Apply the same fix (or its MultiCOGLayer equivalent) to `CompositeBands` pipelines. Likely a per-slot `uvCrop` inside the `compositeBands` uniform block, since each band's texture may crop differently.
- Design `CutlinePolygon` / per-image polygon mask for USGS historical topo support.
- Decide whether `RasterLayer` should ever accept externally-supplied triangulations (for antialiased cutlines). Not needed now.
