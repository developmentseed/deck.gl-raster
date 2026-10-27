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
[`RangeReader`](../range-reader/README.md): the reads a selection of tiles
needs are issued together and merged into few streamed HTTP range requests,
each tile resolves as its bytes arrive, a request is cancelled as soon as
its tiles leave the view, and everything received is cached, so a pan back
over tiles already downloaded costs no request. Every `COGLayer`,
`MultiCOGLayer` and `MosaicLayer` on a page shares that reader's cache and
batching window by default.

- **Tuning.** Pass your own reader to change its gap and over-fetch limits
  or its cache budgets, or to isolate a layer:

  ```ts
  import { RangeReader } from "@developmentseed/range-reader";

  const reader = new RangeReader({
    maxOverfetchBytes: 4 * 1024 * 1024,
    cache: { headerBytes: 64 * 1024 * 1024, dataBytes: 256 * 1024 * 1024 },
  });
  new COGLayer({ id: "scene", source: url, reader });
  ```

  `reader.stats` counts requests, bytes requested and received, bytes
  over-fetched and cache hits.
- **Authentication.** `requestInit` sets the headers, credentials and mode
  of every request a layer's sources make. Sources read with different
  inits never share a request or a cached byte, even for one URL.

  ```ts
  new COGLayer({
    id: "private",
    source: url,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  ```
- **Throttling.** `COGLayer` and `MultiCOGLayer` default to
  `maxRequests: 256` and `debounceTime: 50` so a whole selection reaches
  the reader in one task and a pan settles before anything is requested;
  the per-origin `concurrencyLimiter` (six at a time by default, matching
  the browser's HTTP/1.1 limit) caps the merged requests instead. A tile
  whose load is no longer wanted is aborted as soon as it leaves the view.
  `MosaicLayer`'s own `maxRequests` still caps how many sources open at
  once.
