# @developmentseed/deck.gl-zarr

High-level deck.gl layer for rendering [GeoZarr] datasets directly from a Zarr store, with on-the-fly reprojection to Web Mercator.

[GeoZarr]: https://geozarr.org/

This package builds on [`@developmentseed/deck.gl-raster`] and [`@developmentseed/geozarr`] to render Zarr arrays as a tiled raster source. It uses [zarrita] for store access, pairs the Zarr's native chunk grid with deck.gl's `TileLayer`, and reprojects each chunk into the Web Mercator viewport.

[`@developmentseed/deck.gl-raster`]: https://developmentseed.org/deck.gl-raster/api/deck-gl-raster/
[`@developmentseed/geozarr`]: https://developmentseed.org/deck.gl-raster/api/geozarr/
[zarrita]: https://zarrita.dev/

## Quick Start

```ts
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";
import * as zarr from "zarrita";

// The user creates the zarrita store; wrap it with middleware as needed
const store = new zarr.FetchStore("https://example.com/my-dataset.zarr");
const node = await zarr.open(store, { kind: "group" });

const layer = new ZarrLayer({
  id: "zarr-layer",
  node,
  // One entry per non-spatial dim. Use `null` for the default slice,
  // a number to pin to an index, or a `zarr.Slice` for a range.
  selection: { band: null },
  getTileData,
  renderTile,
});
```

The caller supplies two callbacks:

- **`getTileData(arr, options)`** — receives the opened zarr array for the requested level and a pre-built `sliceSpec`. Call `zarr.get(arr, options.sliceSpec)` and convert the result into whatever shape your `renderTile` expects.
- **`renderTile(data)`** — convert that result into a [`RenderTileResult`] (an `ImageData`/texture, or a custom luma.gl `RenderPipeline`).

[`RenderTileResult`]: https://developmentseed.org/deck.gl-raster/api/deck-gl-raster/type-aliases/RenderTileResult/

This split keeps {@link ZarrLayer} agnostic about data type and rendering pipeline — the layer handles tiling, level selection, and reprojection; you decide how chunks become pixels.

## Features

- **GeoZarr-aware**: Reads the `spatial`, `multiscales`, and `geo-proj` conventions to derive the level pyramid, per-level affine transforms, and CRS.
- **Single- and multi-resolution support**: A plain `[H, W]` or `[bands, H, W]` Zarr array works as a single-level source; a multiscale group is rendered as a pyramid.
- **On-the-fly reprojection**: Source CRS → Web Mercator using [`@developmentseed/raster-reproject`], with no server-side tile service.
- **Caller-owned store**: Pass a pre-opened `zarr.Array` or `zarr.Group` so you control consolidation, range coalescing, authentication, and version selection.

[`@developmentseed/raster-reproject`]: https://developmentseed.org/deck.gl-raster/api/raster-reproject/
