# PMTiles Terrain Example

- **Date:** 2026-10-27
- **Issues:** builds on [#805](https://github.com/developmentseed/deck.gl-raster/pull/805) (merged); needs the range reader from [#806](https://github.com/developmentseed/deck.gl-raster/pull/806) (open); follows [#809](https://github.com/developmentseed/deck.gl-raster/pull/809)'s load settings for COG layers (open); stage 3 needs [#647](https://github.com/developmentseed/deck.gl-raster/pull/647)'s hillshade modules (draft)
- **Status:** Draft for review

Code links are pinned to main at
[`6c9da23b`](https://github.com/developmentseed/deck.gl-raster/commit/6c9da23b40457dfd0c6ae8ca61ee34042f41e548).

## Summary

A new experimental example, `examples/experimental/pmtiles-terrain`, does
for PMTiles what `cog-terrain` does for COGs: 3D terrain you can fly over,
with a deck.gl-raster layer draped on it.

All the data comes from one PMTiles archive: Mapterhorn's global terrain,
`planet.pmtiles`. deck.gl's `TerrainLayer` builds the 3D surface from it. A
`RasterTileLayer` reads the same archive, decodes each tile's elevation on the
GPU and colors it. Both layers read through `@developmentseed/range-reader`, so
the tiles of a view arrive in a few merged requests.

## Why

What someone opening the example should come away with (Kyle, 2026-10-27):

1. This is cool.
2. deck.gl-raster reads PMTiles too. Any tiled source works, not only COG and
   Zarr.
3. It's fast, especially with request coalescing. A clustered PMTiles archive
   stores its tiles in Hilbert order, so the tiles of one view sit close
   together in the file.

**Why Mapterhorn.** Most raster PMTiles are 8-bit RGB images. deck.gl's
`TileLayer` and `BitmapLayer` already draw those, and `titiler-cog` already
shows that `RasterTileLayer` takes any tile grid with your own `getTileData`.
Mapterhorn's tiles are data: each pixel packs an elevation into its RGB bytes
(Terrarium encoding). `BitmapLayer` can't decode and color them on the GPU,
and that's what the example shows deck.gl-raster doing. It is also the largest
public raster PMTiles dataset we found, and its name begs us to open on the
Matterhorn.

## Measured: a view's tiles sit together

On 2026-10-27, a throwaway script read each archive's header and directories,
found where each tile's bytes are, and merged them the way the range reader's
defaults would (`maxGap: "median"`, at most 1 MiB over-fetched per request):

| Archive and tiles | Tiles | Bytes | Contiguous runs | Merged requests |
| --- | --- | --- | --- | --- |
| `planet.pmtiles`, z12, 5x4 block at the Matterhorn | 20 | 3.1 MB | 2 | 2 |
| `planet.pmtiles`, z11, 3x3 block at the Matterhorn | 9 | 1.3 MB | 4 | 4 |
| `6-33-22.pmtiles`, z15, 5x4 block at the Matterhorn | 20 | 3.5 MB | 4 | 4 |

The runs are megabytes apart, so nothing merges across them and nothing is
over-fetched. Each block needed one leaf directory of about 10 KB. Tiles are
140-170 KB each.

**Where the speed comes from.** deck.gl's `TileLayer` loads at most
`maxRequests` tiles at a time, 6 by default, so a 20-tile view loads in four
waves. Raising that limit is only safe when the requests collapse into a few.
#809 gives the COG layers `maxRequests: 256` and `debounceTime: 50`, and lets
the range reader's per-origin limiter cap the real HTTP requests. With the
same settings here, the opening view should load in one wave of 2-4 streamed
requests, and each tile renders as soon as its own bytes arrive.

Mapterhorn serves over HTTP/2, where an extra request costs less than over
HTTP/1.1. So most of the gain should come from the removed throttle and fewer
round trips. Stage 1 measures it rather than assuming it.

## Goals

- Open on the Matterhorn in 3D, and let people fly anywhere. The planet archive
  covers the globe to z12 (about 13 m per pixel at 46°N).
- One archive feeds both layers: the `TerrainLayer` mesh and the draped
  `RasterTileLayer`.
- Decode Terrarium elevation on the GPU, then color it with `LinearRescale` and
  `Colormap`. Controls change the colormap and the elevation range.
- Read through the range reader, and show it working: a live count of tiles
  loaded against HTTP requests and bytes, and a switch to compare with one
  request per tile.
- Put measured numbers in the PR.
- Make the part question 10 may change easy to swap: `PMTilesSource` is a
  `RasterSource`, and the layer takes its `tilesetDescriptor`.

## Non-goals

- A PMTiles source or layer in the library. It stays in the example until
  question 10 of the
  [Sources spec](https://github.com/developmentseed/deck.gl-raster/blob/6c9da23b40457dfd0c6ae8ca61ee34042f41e548/dev-docs/specs/2026-10-22-sources-design.md#L653)
  (a `ServerSource`) is decided.
- PMTiles that aren't Web Mercator, or that hold several bands. They barely
  exist in the wild.
- Vector PMTiles.
- Hillshade and slope in the first PR. They need each tile's neighbors (a
  halo), which #647 is working out. That's stage 3.
- A basemap. `cog-terrain` has none either.

## What would make it a failure

- Wrong elevations. The decode needs each tile's exact bytes, so premultiplied
  alpha, color-space conversion and filtering of the encoded bytes must never
  touch them.
- A "fast" story without numbers, or coalescing that delays the first visible
  tile compared with one request per tile.
- Loads that keep running for tiles that left the view and slow down the tiles
  you're looking at.
- The two layers downloading the same bytes twice.
- Teaching a pattern that question 10 then contradicts without saying so. The
  README says what's provisional.

## Constraints

- Question 10 stays as it is for now: a `RasterTileLayer` used directly takes
  `tilesetDescriptor`, `getTileData` and `renderTile`, as in `titiler-cog`.
- Experimental tier: LLM-generated and unreviewed, badged in the app and listed
  in the docs' experimental section.
- Needs #806's `@developmentseed/range-reader`. If #806 hasn't merged when work
  starts, stack the branch on it. Aborting unwanted loads also needs #809 (see
  decision 1).
- Mapterhorn is a third party. Its hosts send `Access-Control-Allow-Origin: *`
  and honor range requests, but don't expose `ETag` through CORS. Attribution
  is required: "© Mapterhorn", linking to <https://mapterhorn.com/attribution>.
- deck.gl 9.4 on WebGL2. `TerrainExtension` is experimental upstream.

## Design

### The data

- `https://download.mapterhorn.com/planet.pmtiles`: z0-12, 356 GB, clustered,
  gzip-compressed directories, uncompressed tiles.
- Each tile is a 512 x 512 lossless WebP (`VP8L`, checked on a sample tile),
  Terrarium-encoded:
  `elevation = R * 256 + G + B / 256 - 32768` meters, with R, G and B in 0-255.
- The PMTiles header doesn't record the tile size. Mapterhorn documents 512 px.
- Zooms 13-18 live in regional archives named after their z6 tile, such as
  `6-33-22.pmtiles` (the Alps, 615 GB), listed in
  `https://download.mapterhorn.com/download_urls.json`. Coverage inside each is
  partial: `6-33-22` addresses 7.0 million of the 22.4 million tiles its z6
  tile could hold. That's stage 2.

### Files

```
examples/experimental/pmtiles-terrain/
  README.md
  index.html, package.json, tsconfig.json, vite.config.ts
  src/main.tsx
  src/App.tsx                 view, scenes, layers, controls, stats readout
  src/pmtiles-source.ts       PMTilesSource: opens an archive, builds its tile grid
  src/range-reader-source.ts  the bytes source pmtiles reads through
  src/terrarium.ts            getTileData, renderTile, the TerrariumDecode module
  src/terrain-fetch.ts        TerrainLayer's fetch, reading from a PMTilesSource
```

Also an entry in `experimentalExamples` in `docs/src/pages/examples/index.tsx`
and a card image in `docs/static/img/`. The docs workflow already builds every
`examples/experimental/*/`.

New dependencies: `pmtiles` (4.5.0), `@developmentseed/range-reader`
(workspace), `@loaders.gl/core` for `parse` (at deck.gl 9.4's loaders.gl
version), and `proj4` (as in `titiler-cog`).

Two meanings of "source" meet here. `pmtiles` reads bytes through a `Source`
(its own `FetchSource`, or ours, `RangeReaderSource`). deck.gl-raster's
`RasterSource` is opened data that layers draw (`COGSource`, and here
`PMTilesSource`). The README says so in one line.

### Reading through the range reader

`pmtiles` reads bytes through a `Source` with `getBytes(offset, length,
signal, etag)` and `getKey()`. `RangeReaderSource` implements it with
`RangeReader.read(file, { offset, length }, { purpose, limiter, signal })`:

- The page has one `RangeReader` and one `PerOriginSemaphore`, shared by every
  archive and layer, like #809's shared reader.
- `purpose` is `"data"` for reads inside the header's tile data section and
  `"header"` for everything else (header, directories, metadata). The reader
  widens short header reads to aligned 64 KiB blocks, so reading one 10 KB leaf
  directory brings its neighbors along.
- **Return a copy.** The reader resolves each read with a view into a merged
  response or a cached span. Hand `pmtiles` `bytes.slice().buffer`, never
  `bytes.buffer`. That buffer holds the whole merged span, and loaders.gl may
  transfer the buffer to its worker, which would detach the cached bytes.
- A `not-found` result throws an error that names the URL.
- `etag` is ignored. Mapterhorn doesn't expose it, and the reader's file
  identity already pins the URL.

Why merging works with `pmtiles` 4.5:

- The reader sends its batch on `setTimeout(0)`, so every read issued in one
  task merges. That includes reads issued after the awaits inside `getZxy`
  (header, then directory, then tile), which are microtasks of the same task.
- The tiles of a view usually wait on the same leaf directory. `pmtiles` shares
  one fetch per directory (`SharedPromiseCache`). When it resolves, every
  waiting `getZxy` reads its tile in the same task, and those reads merge.
- That shared directory fetch is aborted only when every caller has aborted.
  `pmtiles` counts the callers' signals. One tile's abort can't fail another
  tile's directory read, the problem that zarrita's shared reads have.

### `PMTilesSource`

A `RasterSource` subclass in the example:

- `static async open(url, { tileSize, reader, limiter, signal })` creates
  `new PMTiles(new RangeReaderSource(...))`, reads the header and checks that
  the tile type is WebP or PNG. If not, it throws an error that names the URL
  and the type it found.
- Fields: `archive` (the `PMTiles`), `header` and `tileSize`, plus the base's
  `tilesetDescriptor`, and `geographicBounds` from the header's bounds.
- `tilesetDescriptor` is a WebMercatorQuad tile matrix set with 512 px tiles,
  one level per zoom up to the header's max zoom, built in code. (morecantile
  ships no tile matrix set definitions.) It's wrapped in `TileMatrixSetAdaptor`
  with identity projections for EPSG:3857 and proj4 for EPSG:4326, as in
  [`titiler-cog`'s `buildDescriptor`](https://github.com/developmentseed/deck.gl-raster/blob/6c9da23b40457dfd0c6ae8ca61ee34042f41e548/examples/experimental/titiler-cog/src/titiler.ts#L132).
- `tileSize` is an option because the header doesn't record it. `getTileData`
  throws if a decoded tile's size differs.

Why a `RasterSource` while question 10 is unchanged: it's the piece question 10
would plug in, and one source shared by two layers is exactly the state the
Sources work set out to share. If question 10 lets `RasterTileLayer` take a
`source`, the example changes one prop.

### The draped layer

A `RasterTileLayer` with:

- `tilesetDescriptor: source.tilesetDescriptor`, `getTileData`, `renderTile`,
  and `updateTriggers: { renderTile: [...] }` for the colormap and range.
- `maxRequests: 256` and `debounceTime: 50`, as #809 gives the COG layers.
- `extensions: [new TerrainExtension()]`, `terrainDrawMode: "drape"`, and a
  `zRange` widened from the terrain tiles' bounding boxes, all as in
  `cog-terrain`
  ([`widenZRange`](https://github.com/developmentseed/deck.gl-raster/blob/6c9da23b40457dfd0c6ae8ca61ee34042f41e548/examples/experimental/cog-terrain/src/App.tsx#L201)).
- `onTileUnload` destroys the tile's texture.
- Aborting loads for tiles that left the view: see decision 1.

`getTileData`:

1. `await source.archive.getZxy(z, x, y, signal)`. `undefined` means there's
   no tile, so return `null`.
2. `createImageBitmap(new Blob([data], { type: "image/webp" }), {
   premultiplyAlpha: "none", colorSpaceConversion: "none" })`. The browser
   decodes off the main thread and leaves the bytes exact.
3. `device.createTexture({ data: bitmap, format: "rgba8unorm", sampler })` with
   nearest filtering. Close the bitmap once luma.gl has copied it (check that
   the copy happens before `createTexture` returns).
4. Return `{ texture, width, height, byteLength }`.

### Decoding elevation on the GPU

The example adds a `TerrariumDecode` module between `CreateTexture` and
`LinearRescale`:

```glsl
// color.rgb holds R, G, B / 255. Round back to the bytes so the decode is exact.
vec3 rgb = floor(color.rgb * 255.0 + 0.5);
float elevation = rgb.r * 256.0 + rgb.g + rgb.b / 256.0 - 32768.0;
color = vec4(vec3(elevation), 1.0);
```

The pipeline is `CreateTexture` -> `TerrariumDecode` -> `LinearRescale` (min
and max in meters) -> `Colormap`.

- Precision: every step is exact in a 32-bit float. The largest sum,
  65535.996, needs 24 bits.
- Sampling is nearest. The decode is linear in R, G and B, so filtering before
  decoding would be right in exact arithmetic. But GPUs filter 8-bit textures
  at limited precision, and an error in R is multiplied by 256 m. Nearest is
  exact everywhere. Past z12 it shows pixels about 13 m wide. If that looks
  blocky, the module can read the four neighboring texels with `texelFetch`,
  decode each and interpolate the elevations.

### The terrain

deck.gl's `TerrainLayer`, reading the same `PMTilesSource`:

- `elevationData: "pmtiles://{z}/{x}/{y}"`. The template exists only so
  `TerrainLayer` treats the data as tiled. A `fetch` prop parses z, x and y,
  calls `source.archive.getZxy(z, x, y, signal)` and hands the bytes to
  `parse(data, layer.props.loaders, loadOptions)`, which runs `TerrainLayer`'s
  own `TerrainWorkerLoader`. A missing tile returns `null`.
- `elevationDecoder` from
  [`terrariumDecoder(exaggeration)`](https://github.com/developmentseed/deck.gl-raster/blob/6c9da23b40457dfd0c6ae8ca61ee34042f41e548/examples/experimental/cog-terrain/src/App.tsx#L50),
  `maxZoom: 12`, `operation: "terrain+draw"`, `pickable: true`, and an
  `onTileLoad` that widens `zRange`, all copied from `cog-terrain`.
- When both layers want the same tile, the second read joins the first one's
  request or comes from the byte cache, so the tile downloads once. Whether
  they want the same tiles depends on two different level-of-detail choices:
  deck.gl's `Tileset2D` for the terrain and our traversal for the drape. The
  stats readout shows how often reads are shared. If the mesh needs less
  detail than the drape, `zoomOffset: -1` on the `TerrainLayer` cuts its tile
  count by about four.
- It keeps deck.gl's default `maxRequests`. deck.gl aborts loads that left the
  view only while more than `maxRequests` are in flight, so raising the limit
  without an abort hook would leave stale loads running. `TerrainLayer` doesn't
  pass `debounceTime` on to its `TileLayer` anyway.

### View, scenes and controls

Copied from `cog-terrain`: `MapView` with `TerrainController`, the pitch cap,
the exaggeration slider and its camera rescaling
([`scaleCameraHeight`](https://github.com/developmentseed/deck.gl-raster/blob/6c9da23b40457dfd0c6ae8ca61ee34042f41e548/examples/experimental/cog-terrain/src/App.tsx#L252)),
and the `zRange` tracking. If `a23280d4` ("keep the terrain example's camera
above ground across changes", on `kyle/cog-terrain-camera-fixes`) lands first,
copy it too.

Scenes: the Matterhorn (the default, looking southwest from above Zermatt),
Everest, the Grand Canyon and Yosemite Valley. Each scene sets a view, an
elevation range for the colormap and a view `maxZoom` a little past 12, so the
camera doesn't jump back (see `cog-terrain`'s notes).

Controls:

- Scene.
- Colormap, with a reverse toggle.
- Elevation range, with a "fit to view" button that uses the measured `zRange`
  divided by the exaggeration.
- Exaggeration.
- The stats readout and its switch (next section).

### Showing that it's fast

A readout, updated a few times a second:

- tiles loaded, for the drape and the terrain
- HTTP requests and MB received
- reads that joined a request already in flight or came from the cache

A "Merge requests" switch, on by default. Turning it off swaps in `pmtiles`'
own `FetchSource` and deck.gl's default `maxRequests: 6`. That's a new source,
so the layers remount and the counters reset. A thin wrapper around
`FetchSource.getBytes` counts its requests and bytes, so both modes report the
same numbers.

### Errors

- If `open` fails (network, CORS, not PMTiles, not a raster tile type), the
  panel shows the message.
- If a tile fails, `onTileError` logs it and the tile stays empty.

## Stages

One PR per stage, with a review stop after each.

1. **The example on `planet.pmtiles`** (z0-12): everything above. Needs #806.
2. **High resolution in the Alps.** Open `6-33-22.pmtiles` as a second source
   and draw a second `RasterTileLayer` above the first for z13-18
   (`minZoom: 13`, `extent` set to the archive's bounds). A missing tile
   returns `null`, so the planet layer shows through where coverage stops. The
   terrain mesh stays on the planet archive (z12) unless decision 3 says
   otherwise. Raise the Matterhorn scene's view `maxZoom`.
3. **Hillshade, slope and tinted relief** with #647's modules, once #647 is
   reviewed and its modules have a shared home. A tile's halo neighbors are
   its neighbors on the Hilbert curve too, so they mostly arrive in the same
   merged requests.

## Verification

- `pnpm -r typecheck --no-bail --filter '!docs'`, Biome, and `vite build` for
  the example.
- Unit tests for the pure parts:
  - `RangeReaderSource` against a fake reader: the purpose split, that it
    returns copies, and `not-found`.
  - The WebMercatorQuad tile matrix set builder: tile bounds at z0 and z12.
  - The Terrarium formula: R=128, G=0, B=0 is 0 m, plus a known summit pixel.
- In real, headed Chrome: the opening view renders, and the measured `zRange`
  maximum over the Matterhorn, divided by the exaggeration, is about 4478 m.
- Cold-cache measurements of the opening view with merging on and off: HTTP
  requests, MB, time to the first tile and time to `onViewportLoad`. They go
  in the PR.

## Decisions for Kyle

1. **Aborting loads nobody wants.** #809 adds `abortUnwantedLoads` to
   `RasterTileset2D`, but `RasterTileLayer` exposes it only as a protected
   hook, which the COG layers turn on. A `RasterTileLayer` used directly with
   `maxRequests: 256` needs it too. I recommend a public `abortUnwantedLoads`
   prop, off by default: a few lines, in #809 or here. The alternative is a
   three-line subclass in the example, which is an odd thing for an example to
   teach.
2. **The merge switch.** It makes the "fast" claim visible, but costs a second
   source path and a remount. Keep it, or show the numbers only in the README?
3. **Stage 2 terrain.** Keep the mesh at z12, or send z13+ terrain to the
   regional archive too? That needs a fallback where coverage stops, because
   `TerrainLayer` leaves a hole where a tile is missing.
4. **The name.** `pmtiles-terrain` (mirrors `cog-terrain`) or
   `mapterhorn-terrain`?
5. **Where the adapter ends up.** `RangeReaderSource` stays in the example for
   now. Later it could be exported by `@developmentseed/range-reader` (which
   would then depend on `pmtiles` types), live in a small `deck.gl-pmtiles`
   package, or become part of whatever question 10 decides.

## Calls I made

These are mine, not decided with Kyle. Each is cheap to change.

- Experimental tier, in `examples/experimental/pmtiles-terrain`.
- Open on the Matterhorn, with four scenes.
- `PMTilesSource` subclasses `RasterSource` even though question 10 is
  unchanged.
- Nearest sampling, with manual interpolation as the fallback.
- `TerrainLayer` keeps deck.gl's default `maxRequests`.
- The stats readout and the merge switch are in stage 1.
- The default colormap and each scene's range are tuned by eye.
