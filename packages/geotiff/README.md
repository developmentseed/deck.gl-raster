# @developmentseed/geotiff

Fast, high-level GeoTIFF reader written in TypeScript for the browser, wrapping [`@cogeotiff/core`][cogeotiff-lib].

[cogeotiff-lib]: https://github.com/blacha/cogeotiff

- Easy access to COG tiles and reduced-resolution overviews.
- Automatic nodata mask handling.
- Image decoding off the main thread.
- Supported compressions:
    - Deflate, LERC, LERC+Deflate, LERC+ZSTD, LZW, JPEG (browser-only), WebP (browser-only), ZSTD
    - Support for user-defined decompression algorithms.

## Features

### Full TypeScript

The entire project — both public APIs and internal code — is strongly and exhaustively typed in TypeScript.

Image data fetches return a strongly typed object. With type narrowing we can infer whether data is pixel-interleaved or band-separate:

```ts
import { GeoTIFF } from "@developmentseed/geotiff";

const geotiff = await GeoTIFF.fromUrl(url);
const tile = await geotiff.fetchTile(10, 10);
const { array } = tile;
if ( array.layout === "pixel-interleaved" ) {
    // array is narrowed to type RasterArrayPixelInterleaved

    // TypedArray interleaved pixel data in a single array
    const data = array.data; // RasterTypedArray
} else if ( array.layout === "band-separate" ) {
    // array is narrowed to type RasterArrayBandSeparate

    // TypedArray data per raster band
    const bands = array.bands; // RasterTypedArray[]
}
```

### No unnecessary data copies

Image fetching APIs always return data in their original layout, ensuring data copies only happen with the user's explicit consent.

### Easy access to COG tiles

Use `GeoTIFF.fetchTile` to load `Tile` instances.

```ts
import { GeoTIFF } from "@developmentseed/geotiff";

// RGB Sentinel-2 image over NYC
const url = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif"
const geotiff = await GeoTIFF.fromUrl(url);

// Read full-resolution tile from bottom right of image.
// tile ordering starts at top left.
const tile = await geotiff.fetchTile(10, 10);
const {
    x, // 10
    y, // 10
} = tile;

// tile.array holds data & relevant metadata
const {
    count, // 3 (RGB)
    height, // 1024
    width, // 1024
    transform, // [ 10, 0, 602380, 0, -10, 4497620 ]
    crs, // 32618 (EPSG code)
    mask, // null
    nodata, // 0
} = tile.array;

// Pixel data is in `data` or `bands`, depending on the layout
if (tile.array.layout === "pixel-interleaved") {
    const { data } = tile.array; // Uint8Array(3145728) [49,  51,  46,  42, ...]
}
```

### Convenient access to overviews

The `.overviews` attribute on `GeoTIFF` contains an array of reduced-resolution overviews, ordered from highest to lowest resolution. Use these to fetch tiles at your desired resolution.

```ts
const geotiff = await GeoTIFF.fromUrl("https://example.com/image.tif");
// Read from the first overview
// (the next-highest resolution after the full-resolution image)
const overview = geotiff.overviews[0];
// Read top-left tile of the overview
const tile = await overview.fetchTile(0, 0);
```

### Affine transformation handling

Integrates with [`@developmentseed/affine`] for easy handling of image transforms, associating pixel positions to spatial coordinates.

All loaded {@link RasterArray} instances contain an [`Affine`], tracking the relative image transform of that specific image window.

[`Affine`]: https://developmentseed.org/deck.gl-raster/api/affine/type-aliases/Affine/
[`@developmentseed/affine`]: https://developmentseed.org/deck.gl-raster/api/affine/

### Automatic Nodata Mask handling

With a library like `geotiff.js` or the underlying `@cogeotiff/core`, you have to do extra work to keep track of which of the internal images represent _data_ versus _masks_. We automatically handle nodata values and mask arrays.

### Easy CRS handling

GeoTIFFs can be defined either by an integer EPSG code or by a user-defined CRS.

For integer EPSG codes, the `GeoTIFF.crs` method returns the integer directly, allowing downstream applications to decide how to resolve the EPSG code into WKT or PROJJSON formats (e.g. by querying `https://epsg.io`).

For user-defined CRSes, we automatically parse the CRS into a PROJJSON object, which can be passed directly into `proj4js`. This is natively implemented **without a large cache of PROJ data**. This avoids the need for a large additional dependency like [`geotiff-geokeys-to-proj4`], which would otherwise add 1.5MB to your bundle.

[`geotiff-geokeys-to-proj4`]: https://github.com/matafokka/geotiff-geokeys-to-proj4

If you have an image where the CRS fails to parse, please create an issue.

### Configurable Web Worker pool for image decoding

The `DecoderPool` allows for decoding image data off the main thread.

By default workers are created up to `navigator.hardwareConcurrency`, but you can customize how large the web worker pool is by passing options to the `DecoderPool` constructor.

If you bundle with Vite, set [`worker.format`][vite-worker-format] to `"es"`. The decoder worker uses top-level await and dynamic imports, which Vite's default `iife` worker format doesn't support, so `vite build` fails without it:

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  worker: { format: "es" },
});
```

[vite-worker-format]: https://vite.dev/config/worker-options#worker-format

### Dynamically load compressions as needed

Instead of bundling support for all compressions out of the box, dynamically load the decompressors as required.

Until you try to load an image compressed with, say, [LERC], you don't pay for the bundle size of the dependency.

[LERC]: https://github.com/Esri/lerc

You can also override the built-in decoders with your own by using `DECODER_REGISTRY`. For example, to use a custom zstd decoder:

```ts
import { Compression } from "@cogeotiff/core";
import { DECODER_REGISTRY } from "@developmentseed/geotiff";

DECODER_REGISTRY.set(Compression.Zstd, () =>
  import("your-zstd-module").then((m) => m.decode),
);
```

A decoder is a function that takes an `ArrayBuffer` and a `DecoderMetadata` object and returns a `Promise` of either the decompressed bytes as an `ArrayBuffer` or the decoded pixels. See [`Decoder`] for the full type definition.

[`Decoder`]: https://developmentseed.org/deck.gl-raster/api/geotiff/type-aliases/Decoder/

### Bring your own source

`GeoTIFF.open` takes any [`chunkd`](https://github.com/blacha/chunkd)
`Source`, so a file on disk, in memory, or behind a custom transport can be
opened by composing one; the chunkd packages are separate installs. Give the
header source chunking and caching, since cogeotiff reads offset-table
entries one at a time.

```ts
import { SourceCache, SourceChunk } from "@chunkd/middleware";
import { SourceView } from "@chunkd/source";
import { SourceFile } from "@chunkd/source-file";
import { GeoTIFF } from "@developmentseed/geotiff";

const file = new SourceFile("/data/scene.tif");
const headerSource = new SourceView(file, [
  new SourceChunk({ size: 64 * 1024 }),
  new SourceCache({ size: 16 * 1024 * 1024 }),
]);
const geotiff = await GeoTIFF.open({ headerSource, dataSource: file });
const tile = await geotiff.fetchTile(0, 0);
```

For HTTP, use `GeoTIFF.fromUrl` (next section): it reads through a
`RangeReader`, which merges, streams and caches reads in a way a chunkd
stack cannot.

### Nearly-identical API to Python `async-geotiff`

The TypeScript API is nearly identical to our Python project [`async-geotiff`].

This is extremely useful for us as we build visualization projects for both Python and the browser.

[`async-geotiff`]: https://github.com/developmentseed/async-geotiff

## Reading over HTTP

`GeoTIFF.fromUrl` reads through a
[`RangeReader`](../range-reader/README.md): the reads cogeotiff makes for the
header (IFDs, then one offset-table entry per tile) and the reads for tile
bytes are merged into few streamed range requests, each tile resolves as its
bytes arrive, and everything received is cached, so a pan back over tiles
that were already downloaded costs no request.

```ts
import { GeoTIFF } from "@developmentseed/geotiff";
import { PerOriginSemaphore, RangeReader } from "@developmentseed/range-reader";

// One reader per page: files that share it share its cache and its batching
// window. (The deck.gl layers do this for you.)
const reader = new RangeReader();
const concurrencyLimiter = new PerOriginSemaphore({ maxRequests: 6 });

const tiff = await GeoTIFF.fromUrl("https://example.com/scene.tif", {
  reader,
  concurrencyLimiter,
  // Headers, credentials and mode for every request of this file.
  requestInit: { headers: { authorization: "Bearer ..." } },
});

// Reads issued together are merged: these four tiles become one or two
// range requests, not four.
const tiles = await tiff.fetchTiles([
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
]);
```

Tune the reader, not the file: `maxGap`, `maxOverfetchBytes`,
`maxRequestBytes`, `minMetadataReadBytes` and the cache budgets are
`RangeReader` options (the former `chunkSize` and `cacheSize` options of
`fromUrl` are `minMetadataReadBytes` and `cache.metadataBytes` there).
`reader.stats` counts requests, bytes and cache hits. Without a
`concurrencyLimiter`, every merged request goes out at once; the deck.gl
layers pass a shared per-origin limiter, and so should a page that opens
many files itself. A file replaced in place while open fails its next read
with an `ETag conflict` error, as it did through chunkd, because the parsed
layout no longer applies; open it again.

## Why not build on top of geotiff.js?

The initial implementation of deck.gl-raster used [geotiff.js], and geotiff.js was great for quickly getting started. But there's a few reasons why this project switched to [`@cogeotiff/core`][cogeotiff-lib].

[geotiff.js]: https://geotiffjs.github.io/

- **Fully typed**: `@cogeotiff/core` is fully typed in expressive TypeScript, making it much more enjoyable to build on top of. Even the low-level
- `@cogeotiff/core` implements a bunch of optimizations, like reading [_and utilizing_](https://github.com/blacha/cogeotiff/blob/4781a6375adf419da9f0319d15c8a67284dfb0c4/packages/core/src/tiff.image.ts#L566-L572) the [GDAL "ghost header"](https://gdal.org/en/stable/drivers/raster/cog.html#header-ghost-area) out of the box. In contrast, geotiff.js [can parse](https://github.com/geotiffjs/geotiff.js/blob/ae88c5e8d7b254cdd86d84fcd50254863663980d/src/geotiff.js#L529) but won't automatically use the ghost values.
- **Project scope**: geotiff.js has a _lot_ of code unrelated to the needs of deck.gl-raster. All we need here is really efficient access to individual tiles from the COG. geotiff.js has a bunch of features we don't need: resampling, tile-merging, conversion to RGB, overview choice based on a target resolution, or writing GeoTIFFs.
- **Complexity**: this is subjective. Overall geotiff.js seems to be... fine. But there are various parts of geotiff.js that give me pause. Vendoring a full 1000-line JPEG decoder? Perhaps this is because they need to support JPEG decoding in Node as well (points to differences in project scopes), but it doesn't give me confidence that I could fix a problem there if I had to.
- **Confidence to build on top of**: this is subjective, but geotiff.js doesn't feel focused, like the way that `@cogeotiff/core` is very focused on its targeted, narrow API.
- **JSDoc is hard to read and contribute to**: this is very subjective, but I find it _much_ harder to read and contribute to geotiff.js code written with [JSDoc](https://jsdoc.app/) instead of pure TypeScript.
- **Code quality**: there are various parts of geotiff.js with code just... [commented out](https://github.com/geotiffjs/geotiff.js/blob/ae88c5e8d7b254cdd86d84fcd50254863663980d/src/geotiffimage.js#L161-L174). And the function has [no documentation](https://github.com/geotiffjs/geotiff.js/blob/ae88c5e8d7b254cdd86d84fcd50254863663980d/src/geotiffimage.js#L100-L110). Why is it normalizing? The [`needsNormalization` function](https://github.com/geotiffjs/geotiff.js/blob/ae88c5e8d7b254cdd86d84fcd50254863663980d/src/geotiffimage.js#L86-L98) also has no documentation, and is hard to understand what the equality is checking because it doesn't use TypeScript-standard enums, which would make the code itself readable.

Overall, geotiff.js seems like a fine library, and it was useful to get started with to prove my proof of concept quickly. But if I'm building an entire stack on top of a COG reader, I need to have a huge amount of confidence on what I'm building on, and `@cogeotiff/core` gives that confidence.
