---
sidebar_position: 1
---

# Introduction

**deck.gl-raster** is a collection of packages for GPU-accelerated visualization of georeferenced raster data in [deck.gl](https://deck.gl).

## Features

- **Cloud-Optimized GeoTIFF (COG) Support**: Stream and render COGs directly from cloud storage
- **Zarr Format Support**: Visualize multi-dimensional Zarr arrays
- **Client-Side Reprojection**: GPU-accelerated reprojection for seamless map integration
- **Customizable Rendering**: Apply custom color maps and band math operations

## Packages

This monorepo contains four packages:

| Package | Description |
|---------|-------------|
| [`@developmentseed/deck.gl-raster`](/api/deck.gl-raster) | Core package with `RasterLayer` and `RasterTileset2D` |
| [`@developmentseed/deck.gl-geotiff`](/api/deck.gl-geotiff) | GeoTIFF/COG visualization with `COGLayer`, `GeoTIFFLayer`, and `MosaicLayer` |
| [`@developmentseed/deck.gl-zarr`](/api/deck.gl-zarr) | Zarr format visualization |
| [`@developmentseed/raster-reproject`](/api/raster-reproject) | Standalone mesh generation for client-side raster reprojection |

## Quick Example

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
      url: "https://example.com/cog.tif",
    }),
  ],
});
```

## Requirements

- deck.gl 9.x
- luma.gl 9.x
- WebGL2 or WebGPU capable browser
