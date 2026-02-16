# @developmentseed/geotiff

Fast, high-level GeoTIFF reader written in TypeScript for the browser, wrapping [`@cogeotiff/core`][cogeotiff-lib].

[cogeotiff-lib]: https://github.com/blacha/cogeotiff

## Features

### Convenient access to overviews

The `.overviews` attribute on `GeoTIFF` contains an array of reduced-resolution overviews in order from highest to lowest resolution. The `Overview` class makes it easy to

### Automatic Nodata Mask handling

With a library like `geotiff.js` or the underlying `@cogeotiff/core`, you have to do extra work to keep track of which of the internal images represent _data_ versus _masks_. We automatically handle nodata values and mask arrays.

### Easy CRS handling

GeoTIFFs can be defined either by an integer EPSG code or by a user-defined CRS.

For integer EPSG codes, the `GeoTIFF.crs` method returns the integer directly, allowing downstream applications to decide how to resolve the EPSG code into WKT or PROJJSON formats (e.g. by querying `https://epsg.io`).

For user-defined CRSes, we automatically parse the CRS into a PROJJSON object, which can be passed directly into `proj4js`. This is natively implemented **without a large cache of PROJ data**. This avoids the need for a large additional dependency like [`geotiff-geokeys-to-proj4`], which would otherwise add 1.5MB to your bundle.

[`geotiff-geokeys-to-proj4`]: https://github.com/matafokka/geotiff-geokeys-to-proj4

If you have an image where the CRS fails to parse, please create an issue.

### Dynamically load compressions as needed

Instead of bundling support for all compressions out of the box, dynamically load the decompressors as required.

Until you try to load an image compressed with, say, [LERC], you don't pay for the bundle size of the dependency.

[LERC]: https://github.com/Esri/lerc

### Transparent caching and chunking

There are a lot of great utilities in [`chunkd`](https://github.com/blacha/chunkd) that work out of the box here.

```ts
import { SourceCache, SourceChunk } from '@chunkd/middleware';
import { SourceView } from '@chunkd/source';
import { SourceHttp } from '@chunkd/source-http';
import { GeoTIFF } from '@developmentseed/geotiff';

// 16MB Cache
const cache = new SourceCache({ size: 16 * 1024 * 1024 });

// Chunk requests into 16KB fetches
const chunk = new SourceChunk({ size: 16 * 1024 });

// Raw source to HTTP file
const httpSource = new SourceHttp('https://blayne.chard.com/world.webp.google.cog.tiff');

// HTTP source with chunking and caching
const tiffSource = new SourceView(httpSource, [chunk, cache]);
const geotiff = await GeoTIFF.create(tiffSource);
const tile = await geotiff.fetchTile(0, 0);
```

### Nearly-identical API to Python `async-geotiff`

The TypeScript API is nearly identical to our Python project [`async-geotiff`].

This is extremely useful for us as we build visualization projects for both Python and the browser.

[`async-geotiff`]: https://github.com/developmentseed/async-geotiff

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
