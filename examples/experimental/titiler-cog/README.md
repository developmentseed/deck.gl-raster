# Titiler tiles (experimental)

Raster tiles from a [titiler] server, rendered with `RasterTileLayer`.

Unlike `COGLayer` and `ZarrLayer`, which read the source file's metadata in the
browser, this example only talks to a tile server. titiler reads a Sentinel-2
true color COG and serves each tile as a raw NumPy `.npy` array, not an image.
The browser decodes each array with [npyjs], uploads it to the GPU as a texture,
and renders it with `RasterTileLayer`.

The same approach works with any server that serves per-tile arrays for an
[OGC tile matrix set].

> [!WARNING]
> This example is experimental. Its code is LLM-generated and unreviewed, and
> it may change substantially or be withdrawn.

[titiler]: https://developmentseed.org/titiler/
[npyjs]: https://github.com/aplbrain/npyjs
[OGC tile matrix set]: https://docs.ogc.org/is/17-083r4/17-083r4.html

To view locally:

```bash
pnpm install
pnpm build
cd examples/experimental/titiler-cog
pnpm dev
```

## How it works

1. On load, the app fetches two documents from the public
   [titiler.xyz](https://titiler.xyz/api.html) instance:
   - `/cog/WebMercatorQuad/tilejson.json?url=…`, for the dataset's WGS84
     bounds and maximum zoom.
   - `/tileMatrixSets/WebMercatorQuad`, for the tile pyramid. This becomes the
     `tilesetDescriptor` of `RasterTileLayer`, via `TileMatrixSetAdaptor`.
2. For each tile, `getTileData` fetches
   `/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.npy?url=…`. For an RGB COG, the
   array has shape `(4, 256, 256)` and dtype `uint8`: red, green, blue, and a
   mask band.
3. The red, green, and blue bands are interleaved into an RGBA texture, and the
   mask band becomes a second texture. `renderTile` samples the first with the
   `CreateTexture` GPU module and discards masked pixels with `MaskTexture`.

## Limitations

- One hardcoded COG URL, and only `uint8` RGB tiles are supported.
- The tile matrix set is fixed to `WebMercatorQuad`. `RasterTileLayer` supports
  other tile matrix sets, which would need the matching projection functions.
