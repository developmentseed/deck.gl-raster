# GPU Hillshade from PMTiles (experimental)

Relief shading computed on the GPU from [Mapterhorn]'s global terrain, read
straight from one [PMTiles] archive by `RasterTileLayer`. A tile server bakes
hillshade in at a fixed sun angle; here the sun is a slider.

> [!WARNING]
> This example is experimental. Its code is LLM-generated and unreviewed, and
> it may change substantially or be withdrawn.

[Mapterhorn]: https://mapterhorn.com/
[PMTiles]: https://docs.protomaps.com/pmtiles/

To view locally:

```bash
pnpm install
pnpm build
cd examples/experimental/pmtiles-terrain
pnpm dev
```

## What it shows

- **deck.gl-raster reads PMTiles too.** Any tiled source works, not only COG
  and Zarr: the example reads the archive with the [`pmtiles`] library and
  hands `RasterTileLayer` a tile grid, a `getTileData` and a `renderTile`.
- **The hillshade is computed on the GPU** from raw elevation, so moving the
  sun redraws without fetching anything. The modes are tinted relief,
  hillshade, slope and elevation.
- **Reads are merged.** A clustered PMTiles archive stores its tiles in
  Hilbert order, so the tiles of one view sit close together in the file, and
  the [range reader] merges them into a few streamed requests. The
  "Merge requests" switch compares that with one request per tile.

[`pmtiles`]: https://github.com/protomaps/PMTiles/tree/main/js
[range reader]: ../../../packages/range-reader

## The data

Mapterhorn's `planet.pmtiles` covers the globe to zoom 12 (about 13 m per
pixel at 46°N): 356 GB of 512 px lossless WebP tiles, each pixel a
Terrarium-encoded elevation:

```
elevation = R * 256 + G + B / 256 - 32768   (meters)
```

Elevation data © [Mapterhorn](https://mapterhorn.com/attribution).

## How it works

### Reading the archive through the range reader

`pmtiles` reads bytes through a `Source` (its own is `FetchSource`). Here,
[`RangeReaderSource`](src/pmtiles/range-reader-source.ts) implements one with
`@developmentseed/range-reader`, which merges the reads issued in one task.
A view's tiles usually wait on the same leaf directory, which `pmtiles`
fetches once and shares; when it arrives, every tile reads in the same task,
and those reads merge. The adapter hands `pmtiles` copies of the bytes,
tags tile reads as `data` and directory reads as `metadata`, and raises
`pmtiles`' `EtagMismatch` if the archive is replaced, so `pmtiles` refetches
its directories.

[`PMTilesSource`](src/pmtiles/pmtiles-source.ts) opens an archive as a
deck.gl-raster `RasterSource`: a WebMercatorQuad grid of 512 px tiles bounded
to the archive. Two meanings of "source" meet here: a `pmtiles` `Source` is a
source of bytes, while a `RasterSource` is opened data that layers draw.

The example doesn't use loaders.gl's `PMTilesTileSource`. That takes only a
URL or a `Blob`, so its reads couldn't merge, and it can't cancel a tile.

### The halo

Horn's method needs each pixel's 3 x 3 neighborhood, so at a tile's edge it
needs the neighboring tiles. Each tile uploads a 514 x 514 `r32float` texture
whose outer ring comes from its eight neighbors
([`halo.ts`](src/terrain/halo.ts)), in two phases
([`get-tile-data.ts`](src/terrain/get-tile-data.ts)): the tile draws as soon
as it decodes, using the neighbors already there, and only the ring is
rewritten when the rest arrive. Columns wrap across the antimeridian.

The neighbors are mostly tiles the layer draws anyway, so a tile and its
neighbors share one load per tile through a
[`BorderCache`](src/terrain/border-cache.ts). It keeps only each tile's
border, its outermost rows and columns (8 KiB, not the 1 MiB of decoded
elevation), and aborts a load once every tile waiting on it has aborted.
Neighbors are also neighbors in the file, so they mostly arrive in the same
merged requests.

### Ground distance in Web Mercator

Slope is rise over ground distance, and a Web Mercator pixel covers
`cos(latitude)` times its projected width on the ground. One value per tile
would make the shading jump between rows of tiles (7% between z6 rows near
46°N), so the shader computes it per pixel
([`terrain-derivative.ts`](src/terrain/gpu-modules/terrain-derivative.ts)).

### Exact decoding

Elevations need each tile's exact bytes. Tiles decode without premultiplied
alpha or color conversion, and their pixels are read back the way MapLibre
reads DEM tiles ([`decode-tile.ts`](src/terrain/decode-tile.ts)): through a
canvas, or through `VideoFrame` when the browser adds noise to canvas reads
to resist fingerprinting. Reading back and converting a tile takes about
1-2 ms on the main thread.

## Measured

The opening view at the Matterhorn: 12 tiles drawn and about 30 decoded (the
rest are halo neighbors), each mode measured cold, in headed Chrome.

| Connection | Mode | HTTP requests | Data | All tiles drawn |
| --- | --- | --- | --- | --- |
| fast | per tile | 34-35 | 5.1 MB | 1.3-1.6 s |
| fast | merged | 7 | 4.8 MB | 1.3-1.4 s |
| 150 ms round trips, 20 Mbit/s | per tile | 33-34 | 5.0 MB | 3.1-3.2 s |
| 150 ms round trips, 20 Mbit/s | merged | 7 | 4.8 MB | 2.9-3.0 s |

Mapterhorn serves over HTTP/2, which multiplexes many requests cheaply, so
merging mostly saves requests here; it pays more as round trips get longer.

## What's provisional

- `RasterTileLayer` used directly takes `tilesetDescriptor`, `getTileData` and
  `renderTile`. If it learns to take a `source`, `PMTilesSource` plugs in
  there.
- [`PMTilesTerrainLayer`](src/pmtiles-terrain-layer.ts) exists only to turn
  on `RasterTileLayer`'s protected `_abortUnwantedLoads` hook, until a public
  prop does.
- The PMTiles adapter lives in the example until it moves to library code.
