# @developmentseed/deck.gl-geotiff

High-level API for rendering [Cloud-Optimized GeoTIFFs] in deck.gl.

[Cloud-Optimized GeoTIFFs]: https://cogeo.org/

This uses `@developmentseed/geotiff` and [`@cogeotiff/core`] to efficiently read Cloud-Optimized GeoTIFFs from the browser.

[`@cogeotiff/core`]: https://github.com/blacha/cogeotiff

## Quick Start

```typescript
import { Deck } from '@deck.gl/core';
import { COGLayer } from '@developmentseed/deck.gl-geotiff';

new Deck({
  initialViewState: {
    longitude: 0,
    latitude: 0,
    zoom: 2
  },
  controller: true,
  layers: [
    new COGLayer({
      id: 'cog-layer',
      source: 'https://example.com/my-cog.tif'
    })
  ]
});
```

The {@link COGLayer} is the recommended layer for rendering Cloud-Optimized GeoTIFFs. It leverages deck.gl's [`TileLayer`] to match the internal COG structure, automatically fetching appropriate overviews based on zoom level.

[`TileLayer`]: https://deck.gl/docs/api-reference/geo-layers/tile-layer

## Layers and sources

Each layer takes its data as `source`: an opened source, or the input to open one from, such as a URL.

| Layer | Source | Draws |
| --- | --- | --- |
| {@link COGLayer} | {@link COGSource} | One COG. |
| {@link MultiCOGLayer} | {@link MultiCOGSource} | The bands of one scene stored as separate COGs, such as a Sentinel-2 scene's band files. |
| {@link MosaicLayer} | Whatever its `getSource` opens | Many images, such as the COGs of a STAC search or a GDAL VRT. It opens only the items in view. |

Open a source yourself to read its bounds before drawing, to pass options such as an `epsgResolver`, or to share it between layers:

```ts
import { COGLayer, COGSource } from "@developmentseed/deck.gl-geotiff";

const source = await COGSource.open("https://example.com/my-cog.tif");
const { west, south, east, north } = source.geographicBounds;
new COGLayer({ id: "cog", source });
```

`MosaicLayer` takes its items as `data`, each with a WGS84 `bbox` and a unique `id`. {@link parseVRT} reads the files of a GDAL VRT mosaic as items:

```ts
import {
  COGLayer,
  COGSource,
  MosaicLayer,
  parseVRT,
} from "@developmentseed/deck.gl-geotiff";

const response = await fetch(vrtUrl);
const items = parseVRT(await response.text(), vrtUrl);

new MosaicLayer({
  id: "mosaic",
  data: items,
  getSource: (item, options) => COGSource.open(item.url, options),
  renderSource: (item, { source, subLayerProps }) =>
    new COGLayer({ ...subLayerProps, source }),
});
```

## Using Vite

This package decodes image tiles in a Web Worker. The worker uses top-level await and dynamic imports, which Vite's default worker format (`iife`) doesn't support, so `vite build` fails with an error such as `Top-level await is currently not supported with the 'iife' output format` (Vite 8) or `Invalid value "iife" for option "worker.format"` (Vite 7). Set [`worker.format`][vite-worker-format] to `"es"`:

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  worker: { format: "es" },
});
```

`vite dev` works without this setting, because it doesn't bundle workers.

[vite-worker-format]: https://vite.dev/config/worker-options#worker-format

## Requests, caching and authentication

The COG layers read through one shared
[`RangeReader`](https://developmentseed.org/deck.gl-raster/api/range-reader/): the reads a selection of tiles
needs are issued together and merged into few streamed HTTP range requests,
each tile resolves as its bytes arrive, a request is cancelled as soon as
its tiles leave the view, and everything received is cached, so a pan back
over tiles already downloaded costs no request. Every `COGLayer`,
`MultiCOGLayer` and `MosaicLayer` on a page shares that reader's cache and
batching window by default.

- **Tuning.** Open the source yourself with a reader of your own to change
  its gap and over-fetch limits or its cache budgets, or to isolate a layer
  (`MosaicLayer` takes `reader` as a prop and passes it to `getSource`):

  ```ts
  import { RangeReader } from "@developmentseed/range-reader";

  const reader = new RangeReader({
    maxOverfetchBytes: 4 * 1024 * 1024,
    cache: { metadataBytes: 64 * 1024 * 1024, dataBytes: 256 * 1024 * 1024 },
  });
  const source = await COGSource.open(url, { reader });
  new COGLayer({ id: "scene", source });
  ```

  `reader.stats` counts requests, bytes requested and received, bytes
  over-fetched and cache hits.
- **Authentication.** `requestInit` on `COGSource.open` and
  `MultiCOGSource.open` (and the `MosaicLayer` prop of the same name) sets
  the headers, credentials and mode of every request the source makes.
  Sources read with different inits never share a request or a cached byte,
  even for one URL.

  ```ts
  const source = await COGSource.open(url, {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  new COGLayer({ id: "private", source });
  ```
- **Throttling.** `COGLayer` and `MultiCOGLayer` default to
  `maxRequests: 256` and `debounceTime: 50` so a whole selection reaches
  the reader in one task and a pan settles before anything is requested;
  the per-origin `concurrencyLimiter` (six at a time by default, matching
  the browser's HTTP/1.1 limit) caps the merged requests instead. A tile
  whose load is no longer wanted is aborted as soon as it leaves the view.
  `MosaicLayer`'s own `maxRequests` still caps how many sources open at
  once.
