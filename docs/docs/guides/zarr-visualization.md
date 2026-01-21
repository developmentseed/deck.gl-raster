---
sidebar_position: 2
---

# Zarr Visualization

This guide covers how to visualize Zarr arrays using the `@developmentseed/deck.gl-zarr` package.

## What is Zarr?

Zarr is a format for storing chunked, compressed, N-dimensional arrays. It's particularly useful for large scientific datasets that need to be accessed in chunks over the network.

## Basic Usage

```typescript
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";

new ZarrLayer({
  id: "zarr-layer",
  url: "https://example.com/data.zarr",
});
```

## Working with Multi-Dimensional Data

Zarr arrays can have multiple dimensions (time, depth, variables, etc.). You can select which slice to visualize:

```typescript
new ZarrLayer({
  id: "zarr-layer",
  url: "https://example.com/climate.zarr",
  // Select a specific time slice
  loaderOptions: {
    selection: {
      time: 0,
      level: 0,
    },
  },
});
```

## Combining with Color Maps

Apply color maps to single-band Zarr data:

```typescript
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";
import { colormapModule } from "@developmentseed/deck.gl-raster/gpu-modules";

new ZarrLayer({
  id: "zarr-with-colormap",
  url: "https://example.com/temperature.zarr",
  modules: [colormapModule],
  moduleProps: {
    colormap: "viridis",
    range: [250, 320], // Kelvin
  },
});
```

## Performance Considerations

1. **Chunk alignment**: Ensure your Zarr chunks align well with the tile requests
2. **Compression**: Use efficient compression (e.g., Blosc) for faster network transfer
3. **Consolidate metadata**: Use consolidated metadata for faster initial loading

## Supported Zarr Versions

- Zarr v2
- Zarr v3

## Common Data Sources

Zarr is commonly used for:

- Climate and weather data (ERA5, CMIP6)
- Ocean data (Copernicus Marine)
- Satellite time series
- Any large multi-dimensional scientific dataset
