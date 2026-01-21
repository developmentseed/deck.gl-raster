---
sidebar_position: 2
---

# Quick Start

This guide will help you render your first Cloud-Optimized GeoTIFF using deck.gl-raster.

## Basic Setup

### 1. Create a deck.gl Map

First, set up a basic deck.gl application:

```typescript
import { Deck } from "@deck.gl/core";

const deck = new Deck({
  initialViewState: {
    longitude: -122.4,
    latitude: 37.8,
    zoom: 11,
  },
  controller: true,
  layers: [],
});
```

### 2. Add a COG Layer

Import and add a `COGLayer` to visualize a Cloud-Optimized GeoTIFF:

```typescript
import { Deck } from "@deck.gl/core";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";

const deck = new Deck({
  initialViewState: {
    longitude: -122.4,
    latitude: 37.8,
    zoom: 11,
  },
  controller: true,
  layers: [
    new COGLayer({
      id: "cog-layer",
      url: "https://example.com/your-cog.tif",
    }),
  ],
});
```

## Adding Custom Rendering

### Apply a Color Map

You can apply custom color maps using GPU modules:

```typescript
import { COGLayer, colormapModule } from "@developmentseed/deck.gl-geotiff";

new COGLayer({
  id: "cog-with-colormap",
  url: "https://example.com/dem.tif",
  modules: [colormapModule],
  moduleProps: {
    colormap: "viridis",
    range: [0, 4000], // elevation range in meters
  },
});
```

### Multi-Band RGB Rendering

For multi-band imagery like satellite data:

```typescript
new COGLayer({
  id: "rgb-cog",
  url: "https://example.com/satellite.tif",
  rgbBands: [3, 2, 1], // Red, Green, Blue band indices
});
```

## Using with Mapbox/MapLibre

deck.gl-raster integrates seamlessly with Mapbox GL JS or MapLibre:

```typescript
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import mapboxgl from "mapbox-gl";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: [-122.4, 37.8],
  zoom: 11,
});

const overlay = new MapboxOverlay({
  layers: [
    new COGLayer({
      id: "cog-layer",
      url: "https://example.com/cog.tif",
    }),
  ],
});

map.addControl(overlay);
```

## Next Steps

- Learn about [COG Visualization](../guides/cog-visualization) in detail
- Explore [Zarr Visualization](../guides/zarr-visualization) for multi-dimensional data
- Check the [API Reference](/api/deck.gl-geotiff) for all available options
