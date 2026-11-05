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

const layer = new ZarrLayer({
  id: "zarr-layer",
  // A store for the layer to open at its root, or an opened ZarrSource
  source: store,
  // One entry per non-spatial dim. Use `null` for the default slice,
  // a number to pin to an index, or a `zarr.Slice` for a range.
  selection: { band: null },
  getTileData,
  renderTile,
});
```

To change how the data opens, open it yourself with `ZarrSource.open`: give the `path` to the array or multiscales group to draw, pass `geoZarrMetadata` for a store without GeoZarr metadata, or give an `epsgResolver`. An opened source also gives the data's bounds before any layer exists, and several layers can share it, such as two layers drawing different selections:

```ts
import { ZarrLayer, ZarrSource } from "@developmentseed/deck.gl-zarr";

const source = await ZarrSource.open(store, { path: "temperature" });
if (!source.is("float32")) {
  throw new Error(`Expected float32 data, got ${source.levels[0]!.dtype}`);
}
const { west, south, east, north } = source.geographicBounds;

const layer = new ZarrLayer({
  id: "temperature",
  source,
  selection: { time: 0 },
  getTileData,
  renderTile,
});
```

`source.is(dtype)` checks the data type at run time and narrows the source's type to it, as zarrita's `Array.is` does for an array.

An array inherits the `proj:` and `spatial:` attributes of the group it's in, so `path` can name an array whose GeoZarr metadata is on its group.

The source's `node` is the zarrita group or array it draws. Its store holds the dataset's other arrays, such as coordinates:

```ts
const band = await zarr.open(zarr.root(source.node.store).resolve("band"), {
  kind: "array",
});
```

`ZarrSource.open` and the layer also take an opened zarrita group or array instead of a store. Pass one when the app has opened the node already, for example to read coordinate or label arrays or to browse the hierarchy, or needs control over how it was opened, such as its Zarr version.

The caller supplies two callbacks:

- **`getTileData(arr, options)`** — receives the opened zarr array for the requested level and a pre-built `sliceSpec`. Call `zarr.get(arr, options.sliceSpec)` and convert the result into whatever shape your `renderTile` expects.
- **`renderTile(data)`** — convert that result into a [`RenderTileResult`] (an `ImageData`/texture, or a custom luma.gl `RenderPipeline`).

[`RenderTileResult`]: https://developmentseed.org/deck.gl-raster/api/deck-gl-raster/type-aliases/RenderTileResult/

This split keeps {@link ZarrLayer} agnostic about data type and rendering pipeline — the layer handles tiling, level selection, and reprojection; you decide how chunks become pixels.

## Features

- **GeoZarr-aware**: Reads the `spatial`, `multiscales`, and `geo-proj` conventions to derive the level pyramid, per-level affine transforms, and CRS.
- **Single- and multi-resolution support**: A plain `[H, W]` or `[bands, H, W]` Zarr array works as a single-level source; a multiscale group is rendered as a pyramid.
- **On-the-fly reprojection**: Source CRS → Web Mercator using [`@developmentseed/raster-reproject`], with no server-side tile service.
- **Caller-owned store**: You create the zarrita store, so you control consolidation, range coalescing, and authentication. Pass an opened `zarr.Group` or `zarr.Array` to also control how it's opened.

[`@developmentseed/raster-reproject`]: https://developmentseed.org/deck.gl-raster/api/raster-reproject/
