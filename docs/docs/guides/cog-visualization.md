---
sidebar_position: 1
---

# COG Visualization

This guide covers how to visualize Cloud-Optimized GeoTIFFs (COGs) using the `@developmentseed/deck.gl-geotiff` package.

## What is a COG?

A Cloud-Optimized GeoTIFF is a GeoTIFF file optimized for HTTP range requests, allowing efficient streaming of large raster datasets from cloud storage without downloading the entire file.

## Layer Options

### COGLayer

The `COGLayer` is the primary layer for COG visualization:

```typescript
import { COGLayer } from "@developmentseed/deck.gl-geotiff";

new COGLayer({
  id: "cog-layer",
  url: "https://example.com/cog.tif",

  // Optional: specify which bands to use
  rgbBands: [1, 2, 3],

  // Optional: tile size (default: 256)
  tileSize: 512,

  // Optional: maximum zoom level
  maxZoom: 18,

  // Optional: minimum zoom level
  minZoom: 0,
});
```

### GeoTIFFLayer

For non-tiled GeoTIFFs or when you need more control:

```typescript
import { GeoTIFFLayer } from "@developmentseed/deck.gl-geotiff";

new GeoTIFFLayer({
  id: "geotiff-layer",
  url: "https://example.com/geotiff.tif",
});
```

### MosaicLayer

For STAC-based mosaics and multi-file collections:

```typescript
import { MosaicLayer } from "@developmentseed/deck.gl-geotiff";

new MosaicLayer({
  id: "mosaic-layer",
  mosaicUrl: "https://example.com/mosaic.json",
});
```

## Custom Rendering with GPU Modules

deck.gl-raster uses a modular GPU shader system for custom rendering:

```typescript
import { COGLayer, colormapModule } from "@developmentseed/deck.gl-geotiff";

new COGLayer({
  id: "dem-layer",
  url: "https://example.com/dem.tif",
  modules: [colormapModule],
  moduleProps: {
    colormap: "terrain",
    range: [0, 3000],
  },
});
```

## Working with Different Data Types

### Digital Elevation Models (DEMs)

```typescript
new COGLayer({
  id: "dem",
  url: "https://example.com/dem.tif",
  modules: [colormapModule],
  moduleProps: {
    colormap: "terrain",
    range: [-100, 4000], // meters
  },
});
```

### Satellite Imagery

```typescript
new COGLayer({
  id: "satellite",
  url: "https://example.com/satellite.tif",
  rgbBands: [4, 3, 2], // NIR, Red, Green for false color
});
```

### Single-Band Scientific Data

```typescript
new COGLayer({
  id: "temperature",
  url: "https://example.com/temperature.tif",
  modules: [colormapModule],
  moduleProps: {
    colormap: "coolwarm",
    range: [-20, 40], // Celsius
  },
});
```

## Performance Tips

1. **Use appropriate tile sizes**: Match the tile size to your COG's internal tiling
2. **Set zoom limits**: Use `minZoom` and `maxZoom` to limit requests
3. **Enable caching**: COGs work well with HTTP caching headers
4. **Use overview levels**: Ensure your COGs have overviews for efficient multi-scale viewing
