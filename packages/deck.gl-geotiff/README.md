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
