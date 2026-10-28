# PMTiles Terrain Example

- **Date:** 2026-10-27 (revised the same day: a 2D hillshade, not 3D terrain; revised 2026-10-28: halos fill only from neighbors that load anyway)
- **Issues:** builds on [#805](https://github.com/developmentseed/deck.gl-raster/pull/805) (merged); needs the range reader from [#806](https://github.com/developmentseed/deck.gl-raster/pull/806) (open); follows [#809](https://github.com/developmentseed/deck.gl-raster/pull/809)'s load settings for COG layers (open); ports the hillshade pipeline from [#647](https://github.com/developmentseed/deck.gl-raster/pull/647) (draft)
- **Status:** Accepted (Kyle, 2026-10-27)

Code links are pinned to main at
[`6c9da23b`](https://github.com/developmentseed/deck.gl-raster/commit/6c9da23b40457dfd0c6ae8ca61ee34042f41e548)
and to #647's branch at
[`d64c1b75`](https://github.com/developmentseed/deck.gl-raster/commit/d64c1b75a770a02c932beb37d31b9d1007821029).

## Summary

A new experimental example, `examples/experimental/pmtiles-terrain`, shades
Mapterhorn's global terrain on the GPU, reading it straight from a PMTiles
archive.

It is #647's hillshade with a different data source. It keeps #647's GPU
shading (Horn's method), its sun controls and its four modes: tinted relief,
hillshade, slope and elevation. #647 reads USGS 1 m COGs. This example reads
`planet.pmtiles` with the `pmtiles` library, through
`@developmentseed/range-reader`, into a `RasterTileLayer`. It doesn't use
loaders.gl.

## Why

What someone opening the example should come away with (Kyle, 2026-10-27):

1. This is cool.
2. deck.gl-raster reads PMTiles too. Any tiled source works, not only COG and
   Zarr.
3. It's fast, especially with request coalescing. A clustered PMTiles archive
   stores its tiles in Hilbert order, so the tiles of one view sit close
   together in the file.

**Why hillshade.** Kyle: "focus on hillshading". A tile server bakes
hillshade in at one fixed sun angle. Here the sun is a slider, because the GPU
shades raw elevation on every frame. That's the cool part, and `BitmapLayer`
can't do it.

**Why Mapterhorn.** It is the largest public raster PMTiles dataset we found,
and it covers the globe. Its tiles are elevation data packed into RGB bytes
(Terrarium encoding), not pictures. Its name also begs us to open on the
Matterhorn.

## Measured: a view's tiles sit together

On 2026-10-27, a throwaway script read each archive's header and directories,
found where the tiles of a block around the Matterhorn are stored, and merged
them the way the range reader's defaults would (`maxGap: "median"`, at most
1 MiB over-fetched per request):

| Block of tiles at the Matterhorn | Tiles | Bytes | Contiguous runs, so merged requests |
| --- | --- | --- | --- |
| `planet.pmtiles`, z12, 5x4: a view | 20 | 3.1 MB | 2 |
| `planet.pmtiles`, z12, 7x6: the view and its halo ring | 42 | 6.5 MB | 7 |
| `6-33-22.pmtiles`, z15, 5x4 | 20 | 3.5 MB | 4 |
| `6-33-22.pmtiles`, z15, 7x6 | 42 | 6.8 MB | 8 |

The runs are hundreds of KB to megabytes apart, so nothing merges across them
and nothing is over-fetched. Each block needed one leaf directory of about
10 KB. Tiles are 140-170 KB each.

Hillshade needs each tile's eight neighbors at its edges (the halo, below).
The first design fetched them too, the ring of tiles just off screen. Measured
in the app, that more than doubled the opening view's bytes (4.8 MB instead of
2.0 MB) and made the tiles in view wait behind the ring in the merged
requests. So a halo is now filled only from neighbors that load anyway because
they're in view (Kyle, 2026-10-28).

**Where the speed comes from.** deck.gl's `TileLayer` loads at most
`maxRequests` tiles at a time, 6 by default. Raising that limit is only safe
when the requests collapse into a few. #809 gives the COG layers
`maxRequests: 256` and `debounceTime: 50`, and lets the range reader's
per-origin limiter cap the real HTTP requests. With the same settings, a
view's tiles should arrive as a few streamed requests, all at once, instead of
one request per tile in waves of six. Each tile still draws as soon as its own
bytes arrive.

Mapterhorn serves over HTTP/2, where an extra request costs less than over
HTTP/1.1. So most of the gain should come from the removed throttle and fewer
round trips. Stage 1 measures it rather than assuming it.

## Goals

- Open on the Matterhorn and let people roam the globe. The planet archive
  covers it to z12 (about 13 m per pixel at 46°N).
- Keep #647's four modes, sun azimuth and altitude, vertical exaggeration and
  shading strength.
- No seams, either at tile edges (the halo) or between rows of tiles (the cell
  size that follows latitude).
- Read PMTiles with the `pmtiles` library through the range reader, and show
  it working: a live count of tiles loaded against HTTP requests and bytes,
  and a switch to compare with one request per tile.
- Put measured numbers in the PR.
- Make the part that question 10 of the Sources spec may change easy to swap:
  `PMTilesSource` is a `RasterSource`, and the layer takes its
  `tilesetDescriptor`.

## Non-goals

- 3D terrain. The first draft of this spec had it, and Kyle chose a 2D
  hillshade.
- loaders.gl. See "Why the `pmtiles` library and not loaders.gl".
- A PMTiles source or layer in the library. It stays in the example until
  [question 10](https://github.com/developmentseed/deck.gl-raster/blob/6c9da23b40457dfd0c6ae8ca61ee34042f41e548/dev-docs/specs/2026-10-22-sources-design.md#L653)
  (a `ServerSource`) is decided.
- PMTiles that aren't Web Mercator, or that hold several bands, or vector
  tiles.
- Adding terrain modules to the library's `gpu-modules`. They live in this
  example for now.

## What would make it a failure

- Wrong elevations. The decode needs each tile's exact bytes. Premultiplied
  alpha, color-space conversion and the noise some browsers add to canvas
  reads must never touch them.
- Seams at tile edges, or a jump in shading between rows of tiles.
- A "fast" story without numbers, or coalescing that delays the first visible
  tile compared with one request per tile.
- Loads that keep running for tiles that left the view and slow down the tiles
  you're looking at.
- Memory that balloons. A decoded tile is 1 MiB of float32.
- Teaching a pattern that question 10 then contradicts without saying so. The
  README says what's provisional.

## Constraints

- Question 10 stays as it is for now: a `RasterTileLayer` used directly takes
  `tilesetDescriptor`, `getTileData` and `renderTile`, as in `titiler-cog`.
- Experimental tier: LLM-generated and unreviewed, badged in the app and listed
  in the docs' experimental section.
- #647's code is unreviewed LLM output (its PR says so). Porting it means
  reviewing it here.
- Needs #806's `@developmentseed/range-reader`. If #806 hasn't merged when work
  starts, stack the branch on it. Aborting unwanted loads also needs #809's
  protected hook, which the example's layer subclass turns on.
- Mapterhorn is a third party. Its hosts send `Access-Control-Allow-Origin: *`
  and honor range requests, but don't expose `ETag` through CORS. Attribution
  is required: "© Mapterhorn", linking to <https://mapterhorn.com/attribution>.

## Design

### The data

- `https://download.mapterhorn.com/planet.pmtiles`: z0-12, 356 GB, clustered,
  gzip-compressed directories, uncompressed tiles.
- Each tile is a 512 x 512 lossless WebP (`VP8L`, checked on a sample tile),
  Terrarium-encoded: `elevation = R * 256 + G + B / 256 - 32768` meters, with
  R, G and B in 0-255. Terrarium has no nodata value.
- The PMTiles header doesn't record the tile size. Mapterhorn documents 512 px.
- Zooms 13-18 live in regional archives named after their z6 tile, such as
  `6-33-22.pmtiles` (the Alps, 615 GB), listed in
  `https://download.mapterhorn.com/download_urls.json`. Coverage inside each is
  partial: `6-33-22` addresses 7.0 million of the 22.4 million tiles its z6
  tile could hold. That's stage 2.

### What carries over from #647

| #647 piece | Here |
| --- | --- |
| [`buildHaloArray`](https://github.com/developmentseed/deck.gl-raster/blob/d64c1b75a770a02c932beb37d31b9d1007821029/examples/experimental/terrain-usgs/src/halo.ts) | Kept, but given its neighbors' borders instead of whole tiles |
| [`TerrainDerivative`](https://github.com/developmentseed/deck.gl-raster/blob/d64c1b75a770a02c932beb37d31b9d1007821029/examples/experimental/terrain-usgs/src/gpu-modules/terrain-derivative.ts) | Kept. Its fixed `cellSize` becomes a ground cell size that follows latitude |
| `Hillshade`, `SlopeDegrees`, `ElevationScalar`, `MultiplyShade` | As they are |
| [`makeRenderTile`](https://github.com/developmentseed/deck.gl-raster/blob/d64c1b75a770a02c932beb37d31b9d1007821029/examples/experimental/terrain-usgs/src/render-tile.ts) | As it is |
| [`TileCache`](https://github.com/developmentseed/deck.gl-raster/blob/d64c1b75a770a02c932beb37d31b9d1007821029/examples/experimental/terrain-usgs/src/tile-cache.ts) | Replaced by `TileBorders`: the borders of tiles that have loaded, by z/x/y. Nothing is fetched for a halo |
| [`makeGetTileData`](https://github.com/developmentseed/deck.gl-raster/blob/d64c1b75a770a02c932beb37d31b9d1007821029/examples/experimental/terrain-usgs/src/get-tile-data.ts) | Loads only its own tile. Its ring starts from the neighbors already loaded, and only the ring is rewritten when another loads |
| `ValueSlider`, the controls, the MapLibre basemap | As they are, but the USGS cell picker becomes a place picker |
| `usgs/cells.ts` and the COG reads | Replaced by PMTiles |

### Reading the archive

`pmtiles` reads bytes through a `Source` with `getBytes(offset, length,
signal, etag)` and `getKey()`. The example's `RangeReaderSource` implements it
with `RangeReader.read(file, { offset, length }, { purpose, limiter, signal })`:

- The page has one `RangeReader` and one `PerOriginSemaphore`, like #809's
  shared reader.
- `purpose` is `"data"` for reads inside the header's tile data section and
  `"metadata"` for everything else (header, directories, JSON metadata). The
  adapter learns the section from the first read at offset 0, parsed with
  `pmtiles`' `bytesToHeader`. The reader widens short metadata reads to
  aligned 64 KiB blocks, so reading one 10 KB leaf directory brings its
  neighbors along.
- **Return a copy.** The reader resolves each read with a view into a merged
  response or a cached span. Hand `pmtiles` `bytes.slice().buffer`, never
  `bytes.buffer`, which holds the whole merged span.
- A `not-found` result throws an error that names the URL.
- Validators work as in #807's chunkd adapter
  (`packages/geotiff/src/reader-source.ts`). The adapter remembers the first
  read's validator (`ETag`, or `Last-Modified` when there is none). A
  different one later throws `pmtiles`' `EtagMismatch`, which makes `getZxy`
  drop its cached header and directories and retry once. The reader drops its
  own cached bytes of the old version.

Why merging works with `pmtiles` 4.5:

- The reader sends its batch on `setTimeout(0)`, so every read issued in one
  task merges. That includes reads issued after the awaits inside `getZxy`
  (header, then directory, then tile), which run as microtasks of the same
  task.
- The tiles of a view usually wait on the same leaf directory. `pmtiles` shares
  one fetch per directory (`SharedPromiseCache`). When it resolves, every
  waiting `getZxy` reads its tile in the same task, and those reads merge.
- `pmtiles` aborts a shared directory fetch only when every caller's signal
  has aborted. One tile's abort can't fail another tile's directory read, the
  problem that zarrita's shared reads have.

`PMTilesSource`, a `RasterSource` subclass in the example:

- `static async open({ byteSource, tileSize })` creates
  `new PMTiles(byteSource)`, reads the header and checks that the tile type is
  WebP or PNG. If not, it throws an error that names the URL and the type it
  found. `byteSource` is a `RangeReaderSource`, or, with merging switched
  off, a counting wrapper around `pmtiles`' own `FetchSource`.
- Fields: `archive` (the `PMTiles`), `header` and `tileSize`, plus the base's
  `tilesetDescriptor`, and `geographicBounds` from the header's bounds.
- `tilesetDescriptor` is a WebMercatorQuad tile matrix set with 512 px tiles,
  one level per zoom up to the header's max zoom, built in code (morecantile
  ships no tile matrix set definitions). It's wrapped in `TileMatrixSetAdaptor`
  with identity projections for EPSG:3857 and proj4 for EPSG:4326, as in
  [`titiler-cog`'s `buildDescriptor`](https://github.com/developmentseed/deck.gl-raster/blob/6c9da23b40457dfd0c6ae8ca61ee34042f41e548/examples/experimental/titiler-cog/src/titiler.ts#L132).
- `tileSize` is an option because the header doesn't record it. Decoding throws
  if a tile's size differs.

Why a `RasterSource` while question 10 is unchanged: it's the piece question 10
would plug in. If question 10 lets `RasterTileLayer` take a `source`, the
example changes one prop.

Two meanings of "source" meet here. `pmtiles` reads bytes through a `Source`
(its own `FetchSource`, or our `RangeReaderSource`). deck.gl-raster's
`RasterSource` is opened data that layers draw (`COGSource`, and here
`PMTilesSource`). The README says so in one line.

### Why the `pmtiles` library and not loaders.gl

loaders.gl wraps the same library as
[`@loaders.gl/pmtiles`](https://unpkg.com/@loaders.gl/pmtiles@4.5.4/dist/pmtiles-source.js)
(`PMTilesTileSource`, version 4.5.4). Compared with using `pmtiles` directly:

| | `pmtiles` 4.5 directly | loaders.gl `PMTilesTileSource` 4.5.4 |
| --- | --- | --- |
| Where bytes come from | Any `Source`, so ours: reads merge in the range reader | A URL or a `Blob` only, read by `pmtiles`' own `FetchSource`: no merging |
| Cancelling a tile | `getZxy(z, x, y, signal)`. Directory fetches count their callers' signals | Calls `getZxy(z, x, y)` with no signal, and its `GetTileParameters` has none, so a tile load can't be cancelled |
| Library version | 4.5.0, the current release | Pins `pmtiles` ^3.0.4 |
| Decoding | Ours, with exact bytes | `ImageLoader.parse` returns an image. We'd still read its pixels back ourselves |
| Dependencies | `pmtiles` (plus `fflate`) | Adds `@loaders.gl/mvt`, `images`, `schema` and `loader-utils`, and needs `@loaders.gl/core` ~4.5 |
| What it offers | Header, directories, tiles, metadata, TileJSON | The same behind loaders.gl's `TileSource` interface, plus MVT parsing and image decoding |

loaders.gl's strengths are one `TileSource` interface across formats and image
decoding done for you. Neither helps here: the example needs raw elevation
pixels and its own byte path. Using it would cost the merged reads (the "fast"
message) and cancellation. The glue `pmtiles` leaves to us is small: the
`Source` adapter (about 40 lines), the tile grid and the decode.

### Decoding a tile to elevation

For each tile:

1. `await source.archive.getZxy(z, x, y, signal)`. `undefined` means no tile.
2. `createImageBitmap(new Blob([data], { type: "image/webp" }), {
   premultiplyAlpha: "none", colorSpaceConversion: "none" })`. The browser
   decodes off the main thread.
3. Read the pixels back the way MapLibre does for its DEM tiles
   ([`getImageData`](https://github.com/maplibre/maplibre-gl-js/blob/4b6b84185dc6a33494b2820d4bbacf1da72fd49a/src/util/util.ts#L882-L969)):
   draw into an `OffscreenCanvas` and call `getImageData`. If the canvas is
   distorted, fall back to `VideoFrame.copyTo` (WebCodecs), swapping BGR frames
   to RGB. Some browsers add noise to canvas reads as a fingerprinting defense,
   which would scramble the Terrarium bytes. MapLibre
   [detects that once](https://github.com/maplibre/maplibre-gl-js/blob/4b6b84185dc6a33494b2820d4bbacf1da72fd49a/src/util/offscreen_canvas_distorted.ts),
   by drawing known pixels and reading them back.
4. Convert to a `Float32Array` with the Terrarium formula. It's exact in
   float32: with R, G and B as integers, the largest sum (65535.996) needs 24
   bits.

Steps 3 and 4 run on the main thread at first. Measure their time per tile. If
it shows up in frame times, move them into a worker (`OffscreenCanvas` and
`VideoFrame` both exist there).

### Tile borders

- One `TileBorders` per archive, keyed by z/x/y.
- **It keeps each loaded tile's border, not the whole tile:** its top and
  bottom rows and its left and right columns, 4 x 512 floats (8 KiB) instead
  of 1 MiB. A neighbor's halo needs only that, so it can hold thousands of
  borders. A tile's full elevation is needed once, to upload its own texture,
  and is not kept.
- Borders outlive their tiles, so a tile that loads later still finds its
  neighbor's border after deck.gl has evicted the neighbor. Least recently
  used borders are evicted by count.
- Loaded tiles watch for their neighbors. When a tile adds its border, each
  loaded neighbor rewrites its side of the ring.
- It fetches nothing, so there's nothing to cancel: a tile's load is deck.gl's
  own, and deck.gl aborts it.

### Building the halo

- Neighbors are `(z, x + dx, y + dy)` for `dx, dy` in -1, 0, 1. x wraps modulo
  2^z: tiles across the antimeridian are real neighbors. A y outside
  `[0, 2^z)` has no neighbor, so the tile's own edge is replicated there, as
  in #647 and `gdaldem`.
- A tile loads only itself. Once it decodes, it adds its border, then builds
  the 514 x 514 array from itself and the borders of the neighbors already
  loaded, and uploads it as `r32float` with nearest sampling and edge
  clamping. The tile draws at once. A side whose neighbor hasn't loaded
  replicates the tile's own edge; that neighbor isn't in view, so neither is
  the side.
- When a neighbor loads later, write only the ring, four strips one texel
  wide, with luma.gl 9.4's `texture.writeData(data, { x, y, width, height })`,
  then ask for a redraw. #647 fetches every neighbor, and rebuilds and
  rewrites the whole texture when they arrive.
- Where tiles of two zoom levels meet, the finer tile's neighbor at its own
  zoom may never load, so that side stays replicated.
- `getTileData` returns the logical size (512) as `width` and `height`, as in
  #647, so the mesh stays on the unpadded grid.

### Cell size in Web Mercator

Slope is rise over ground distance. A WebMercatorQuad texel at zoom z is
`C_z = 2 * pi * 6378137 / (512 * 2^z)` meters wide in projected units, but
`C_z * cos(latitude)` on the ground. Mercator is conformal, so the same factor
applies in x and y.

Latitude varies across a tile, and a per-tile `cellSize` taken at the tile's
center would show seams. At z6 near 46°N, tile row 22 spans 45.0-49.0°N and
row 23 spans 41.0-45.0°N. Their center cosines differ by 7%, so the shading
would jump at the boundary between them. At z12 the variation within a tile is
about 0.1%. The example lets people zoom out to the Himalaya at z5, so this
matters.

So `TerrainDerivative` computes the latitude per fragment. The tile passes its
Mercator y range, which is exact because a WebMercatorQuad tile is linear in
Mercator y:

```glsl
// geometry.uv.y is 0 at the tile's north edge (check against the mesh).
float mercatorY = mix(terrainDerivative.mercatorYNorth, terrainDerivative.mercatorYSouth, geometry.uv.y);
float latitude = 2.0 * atan(exp(mercatorY / 6378137.0)) - 0.5 * PI;
float groundCellSize = terrainDerivative.cellSize * cos(latitude);
```

#647 is parked, so the module needs only this Mercator form.

### The layer

A `RasterTileLayer` with:

- `tilesetDescriptor: source.tilesetDescriptor`, `getTileData` (above) and
  `renderTile` from `makeRenderTile`.
- `maxRequests: 256` and `debounceTime: 50`, as #809 gives the COG layers.
- `onTileUnload` destroys the tile's texture and stops it watching for
  neighbors.
- Aborting loads for tiles that left the view: the example subclasses
  `RasterTileLayer` and overrides #809's protected `_abortUnwantedLoads()` to
  return `true`. There's no public prop for it yet.

Past z12 the planet tiles are stretched, and with `texelFetch` each texel's
shade covers a block of screen pixels. If that looks blocky, blend the shade of
the four nearest texels. Stage 2 adds real z13-18 data in the Alps.

### View, places and controls

As in #647: a 2D MapLibre map with a dark basemap and a `DeckGlOverlay`.
MapLibre's attribution control carries "© Mapterhorn".

Places: the Matterhorn (the default), Everest, the Grand Canyon (#647's card
image) and Yosemite Valley. Each sets a view and a colormap range for the
elevation modes.

Controls: place, visualization mode, sun azimuth, sun altitude, vertical
exaggeration and shading strength (all from #647), plus the stats readout and
its switch.

### Showing that it's fast

A readout, updated a few times a second:

- tiles drawn
- HTTP requests and MB received
- reads that joined a request already in flight or came from the byte cache

A "Merge requests" switch, on by default. Turning it off swaps in `pmtiles`'
own `FetchSource` and deck.gl's default `maxRequests: 6`. That's a new source,
so the layer remounts and the counters reset. A thin wrapper around
`FetchSource.getBytes` counts its requests and bytes, so both modes report the
same numbers.

### Errors

- If `open` fails (network, CORS, not PMTiles, not a raster tile type), the
  panel shows the message.
- If a tile fails, `onTileError` logs it and the tile stays empty. A neighbor
  that fails leaves its side of the ring replicated, as in #647.

## Stages

One PR per stage, with a review stop after each.

1. **Hillshade from `planet.pmtiles`** (z0-12): everything above. Needs #806.
2. **High resolution in the Alps.** Open `6-33-22.pmtiles` as a second source
   and draw a second `RasterTileLayer` above the first for z13-18 (`minZoom:
   13`, `extent` set to the archive's bounds). A missing tile returns `null`,
   so the planet layer shows through where coverage stops. Halos at the
   coverage edge replicate. Raise the Matterhorn's view `maxZoom`.

Later, the `pmtiles` adapter and `PMTilesSource` move into library code,
shaped by whatever question 10 decides. If #647's USGS 1 m data comes back, it
reuses this example's pieces.

## Verification

- `pnpm -r typecheck --no-bail --filter '!docs'`, Biome, and `vite build` for
  the example.
- Unit tests for the pure parts:
  - #647's halo tests, ported to borders.
  - Neighbor addressing, including the wrap at the antimeridian and the missing
    rows past the poles.
  - The Terrarium conversion (R=128, G=0, B=0 is 0 m) and the ground cell size
    at known latitudes.
  - `RangeReaderSource` against a fake reader: the purpose split, that it
    returns copies, and `not-found`.
  - Tile borders: a tile loads only itself; a side fills from a neighbor
    that loaded first, and is rewritten when one loads later.
- In real, headed Chrome:
  - The opening view renders.
  - No seams at tile edges or between tile rows, at z5 and z12.
  - Moving the sun redraws without refetching.
  - In Firefox with `privacy.resistFingerprinting` on, the decode takes the
    `VideoFrame` path and the shading still looks right.
- Cold-cache measurements of the opening view with merging on and off: HTTP
  requests, MB, time to the first tile, time until every ring is complete, and
  main-thread decode time per tile. They go in the PR.

## Decisions

Kyle, 2026-10-27:

- **No loaders.gl.** The example reads PMTiles with the `pmtiles` library.
- **This is the hillshade example.** #647's modules are ported and reviewed
  here, and #647 is parked.
- **The merge switch stays.**
- **The `pmtiles` adapter lives in the example** for now and moves to library
  code later.
- **Tile borders in the cache, rewriting only the ring, and cancelling
  abandoned fetches:** +1. The cache and its cancellation were superseded on
  2026-10-28 (below): nothing is fetched for a halo, so there's nothing to
  cancel.
- **Aborting unwanted loads: a subclass in the example, for now.** #809 adds
  `abortUnwantedLoads` to `RasterTileset2D` but exposes it on
  `RasterTileLayer` only as a protected hook, which the COG layers turn on.
  The example's layer subclass overrides the hook rather than adding a public
  prop. This matters here: with `maxRequests: 256`, deck.gl no longer aborts
  loads for tiles that left the view.

Kyle, 2026-10-28, after browsing the example ("it's kinda slow"):

- **Fill a halo only from neighbors that load anyway.** "Instead of
  pre-fetching the entire halo, we should only fill in the halo _when its
  neighbors are already loaded_. So only fill in a side when a neighbor is
  also in view, essentially."

## Calls I made

These are mine, not decided with Kyle. Each is cheap to change.

- Experimental tier, in `examples/experimental/pmtiles-terrain`, laid out like
  #647: a 2D MapLibre map with a dark basemap.
- Open on the Matterhorn, with four places.
- The latitude correction per fragment, rather than one cell size per tile.
- Borders kept after their tiles unload, up to 2048 (16 MiB), and a refine
  step that rewrites only the ring.
- Decoding on the main thread first, with MapLibre's canvas and `VideoFrame`
  readback.
