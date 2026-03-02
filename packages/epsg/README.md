# @developmentseed/epsg

The full EPSG projection database, compressed to **309kb** for the web.

[EPSG]:

Some existing EPSG amalgamations exist, but all are uncompressed, incomplete, outdated, and/or not reproducible ([^1] [^2] [^3] [^4]). This package uses the [DecompressionStream] API, now [widely available in browsers][DecompressionStream_gzip], to bundle a gzip-compressed text file of WKT definitions for **all 7352 defined EPSG codes**.

[DecompressionStream]: https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream
[DecompressionStream_gzip]: https://caniuse.com/mdn-api_decompressionstream_decompressionstream_gzip

[^1]: [`epsg`](https://www.npmjs.com/package/epsg) includes only 3912 definitions, stores older, deprecated proj strings, and is uncompressed, coming to 500kb.

[^2]: [`epsg-index`](https://www.npmjs.com/package/epsg-index) stores extra parsed information for each projection and is **7.7 MB**.

[^3]: [`proj4-list`](https://www.npmjs.com/package/proj4-list) includes only 5434 definitions, stores older, deprecated proj strings, and is 759KB of uncompressed strings.

[^4]: [`@esri/proj-codes`](https://www.npmjs.com/package/@esri/proj-codes) ships a lot of redundant information, coming to nearly **15MB** of JSON.

## Usage

Currently, the only package entrypoint is `@developmentseed/epsg/all`, which loads a `Map<number, string>`, with all EPSG definitions in OGC WKT2 format.

```ts
import loadEPSG from "@developmentseed/epsg/all";
import proj4 from "proj4";

// Load the EPSG database
const epsg = await loadEPSG();

// Access WKT strings by EPSG code.
const wkt4326 = epsg.get(4326);
const wkt3857 = epsg.get(3857);

// Then use proj4.js as normal
const converter = proj4(wkt4326, wkt3857);
const inputPoint = [1, 52];
const outputPoint = converter.forward(inputPoint);
```

## Generate new EPSG definitions

First, download the latest EPSG definitions in WKT format. Go to <https://epsg.org/download-dataset.html>, create an account or log in, then download the `WKT File` version.

Then, from this directory, run

```bash
python scripts/generate.py
```

Then the file `src/all.csv.gz` will be updated with the latest EPSG definitions.

## Publishing

The `build` script in `package.json` will automatically include `all.csv.gz` in the published NPM package.

If you get an error like

> `cp: dist/all.csv.gz: No such file or directory`

You may need to delete an errant `tsconfig.build.tsbuildinfo` and try again. I'm not sure why.

