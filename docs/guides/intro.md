---
sidebar_position: 1
slug: /intro
---

# Introduction

deck.gl-raster is a collection of TypeScript modules to enable loading [GeoTIFF][geotiff] and [Cloud-Optimized GeoTIFF][cogeo] (COG) data in the browser and interactively visualizing it in [deck.gl].

[geotiff]: https://en.wikipedia.org/wiki/GeoTIFF
[cogeo]: https://cogeo.org/
[deck.gl]: https://deck.gl/
[Zarr]: https://zarr.dev/

## Features

- **Fully client-side**: Direct COG/Zarr loading with no server required
- **GPU-accelerated image processing**:
  - Converting color spaces (CMYK, YCbCr, CIELAB to RGB)
  - Filtering out nodata values
  - Applying colormaps for paletted images
  - _Soon_: color correction, nodata masks, spectral band math, pixel filtering
- **Intelligent rendering**: Automatically infers default render behavior from GeoTIFF metadata
  - Alternatively, fully-customizable rendering with no GPU knowledge required
- **Native tiling**: Renders tiled data sources _in their native tiling scheme_, without translating to a Web Mercator tiling grid.
- **Flexible reprojection**: GPU-based raster reprojection from most projections[^1]
- **Efficient streaming**: Intelligent COG rendering fetches only visible image portions
- **Multi-resolution support**: Automatic overview selection based on zoom level

[^1]: The raster reprojection has not been tested on polar projections or when spanning the antimeridian.

## Packages

We're building a new, modular raster data ecosystem for the web; this monorepo contains several packages, each published independently to NPM under the `@developmentseed` namespace:

| Package              | Description                                                     | Version                                                    |
| -------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| [`affine`]           | Port of [`rasterio/affine`] for managing affine transformations | [![npm][affine-npm-badge]][affine-npm]                     |
| [`deck.gl-geotiff`]  | High-level deck.gl layers for GeoTIFF & COG visualization       | [![npm][deck.gl-geotiff-npm-badge]][deck.gl-geotiff-npm]   |
| [`deck.gl-zarr`]     | High-level deck.gl layers for Zarr visualization (_soon_)       | -                                                          |
| [`deck.gl-raster`]   | Core georeferenced raster rendering primitives                  | [![npm][deck.gl-raster-npm-badge]][deck.gl-raster-npm]     |
| [`epsg`]             | The full EPSG projection database, compressed for the web       | [![npm][epsg-npm-badge]][epsg-npm]                         |
| [`geotiff`]          | Fast, high-level, fully-typed GeoTIFF & COG reader              | [![npm][geotiff-npm-badge]][geotiff-npm]                   |
| [`morecantile`]      | Port of [Morecantile] for working with OGC [TileMatrixSets]     | [![npm][morecantile-npm-badge]][morecantile-npm]           |
| [`raster-reproject`] | Standalone mesh-based image reprojection utilities              | [![npm][raster-reproject-npm-badge]][raster-reproject-npm] |

[`affine`]: #developmentseedaffine
[`deck.gl-geotiff`]: #developmentseeddeckgl-geotiff
[`deck.gl-zarr`]: #developmentseeddeckgl-zarr
[`deck.gl-raster`]: #developmentseeddeckgl-raster
[`epsg`]: #developmentseedepsg
[`geotiff`]: #developmentseedgeotiff
[`morecantile`]: #developmentseedmorecantile
[`raster-reproject`]: #developmentseedraster-reproject

[`rasterio/affine`]: https://github.com/rasterio/affine
[Morecantile]: https://github.com/developmentseed/morecantile
[TileMatrixSets]: https://docs.ogc.org/is/17-083r4/17-083r4.html

[affine-npm-badge]: https://img.shields.io/npm/v/@developmentseed/affine
[deck.gl-geotiff-npm-badge]: https://img.shields.io/npm/v/@developmentseed/deck.gl-geotiff
[deck.gl-raster-npm-badge]: https://img.shields.io/npm/v/@developmentseed/deck.gl-raster
[epsg-npm-badge]: https://img.shields.io/npm/v/@developmentseed/epsg
[geotiff-npm-badge]: https://img.shields.io/npm/v/@developmentseed/geotiff
[morecantile-npm-badge]: https://img.shields.io/npm/v/@developmentseed/morecantile
[raster-reproject-npm-badge]: https://img.shields.io/npm/v/@developmentseed/raster-reproject

[affine-npm]: https://www.npmjs.com/package/@developmentseed/affine
[deck.gl-geotiff-npm]: https://www.npmjs.com/package/@developmentseed/deck.gl-geotiff
[deck.gl-raster-npm]: https://www.npmjs.com/package/@developmentseed/deck.gl-raster
[epsg-npm]: https://www.npmjs.com/package/@developmentseed/epsg
[geotiff-npm]: https://www.npmjs.com/package/@developmentseed/geotiff
[morecantile-npm]: https://www.npmjs.com/package/@developmentseed/morecantile
[raster-reproject-npm]: https://www.npmjs.com/package/@developmentseed/raster-reproject


## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Application Layer                                          │
│  ├─ COGLayer / GeoTIFFLayer                                 │
│  └─ Custom visualization layers                             │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Raster Processing Layer                                    │
│  ├─ RasterLayer (core rendering)                            │
│  ├─ RasterTileset2D (tile management)                       │
│  └─ GPU Modules (color space, filters, colormaps)           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Reprojection Layer                                         │
│  ├─ RasterReprojector (mesh generation)                     │
│  └─ proj4 (coordinate transforms)                           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Data Layer                                                 │
│  ├─ @developmentseed/geotiff (COG parsing & streaming).     │
│  └─ HTTP range requests                                     │
└─────────────────────────────────────────────────────────────┘
```

**Render Pipeline**: A composable sequence of GPU modules that transform raw raster data into displayable imagery. Pipelines are automatically inferred from GeoTIFF metadata or can be customized.

**Adaptive Mesh Reprojection**: Instead of per-pixel transformation, the library generates an adaptive triangular mesh that warps texture coordinates. This enables efficient GPU-based reprojection with minimal distortion.

**Tile Streaming**: For COGs, only the tiles visible in the current viewport are fetched. As you zoom, higher-resolution overviews are automatically loaded.

**Zero-Copy Texture Upload**: Raw raster data is uploaded directly to GPU textures, minimizing CPU-GPU transfer overhead.
