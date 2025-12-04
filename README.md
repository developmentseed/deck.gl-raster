# @developmentseed/deck.gl-raster

GPU-accelerated COG and Zarr visualization in deck.gl

## Features

- 🚀 High-performance raster visualization using WebGL
- 🗺️ Support for Cloud Optimized GeoTIFF (COG)
- 📊 Support for Zarr format
- 🎨 Customizable rendering and color mapping
- 📦 Modern ESM package for JavaScript and TypeScript

## Installation

```bash
npm install @developmentseed/deck.gl-raster
```

## Usage

```typescript
import { RasterLayer } from '@developmentseed/deck.gl-raster';
import { Deck } from '@deck.gl/core';

const layer = new RasterLayer({
  id: 'raster-layer',
  data: 'https://example.com/data.tif',
  bounds: [-122.5, 37.7, -122.3, 37.9],
});

new Deck({
  initialViewState: {
    longitude: -122.4,
    latitude: 37.8,
    zoom: 11,
  },
  controller: true,
  layers: [layer],
});
```

## Development

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint

# Format code
npm run format

# Type check
npm run typecheck
```

## API Reference

### RasterLayer

A deck.gl layer for rendering raster data from GeoTIFF and Zarr sources.

#### Props

- `data` (string | URL): URL to the raster data source
- `bounds` ([number, number, number, number]): Bounding box as [minLon, minLat, maxLon, maxLat]

## License

MIT © Development Seed
