# deck.gl-raster

GPU-accelerated [GeoTIFF][geotiff] and [Cloud-Optimized GeoTIFF][cogeo] (COG) (and _soon_ [Zarr]) visualization in [deck.gl].

Fully client-side with direct image loading, no server required.

[geotiff]: https://en.wikipedia.org/wiki/GeoTIFF
[cogeo]: https://cogeo.org/
[deck.gl]: https://deck.gl/
[Zarr]: https://zarr.dev/

[![](./assets/land-cover.jpg)](https://developmentseed.org/deck.gl-raster/examples/land-cover/)

<p align="center"><em><b>1.3GB</b> Land Cover COG rendered in the browser with <b>no server</b></em>: <a href="https://developmentseed.org/deck.gl-raster/examples/land-cover/">Live demo.</a></p>

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

## Examples

- **[Land Cover](https://developmentseed.org/deck.gl-raster/examples/land-cover/)**: 1.3GB NLCD land cover COG with custom colormap
- **[NAIP Client-side Mosaic](https://developmentseed.org/deck.gl-raster/examples/naip-mosaic/)**: Client-side mosaic of [NAIP](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip) COGs, loaded directly from [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/naip). No server involved. Switch between true color, false color infrared, and NDVI renderings
- **[COG Basic](https://developmentseed.org/deck.gl-raster/examples/cog-basic/)**: RGB aerial imagery with automatic reprojection

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

## deck.gl Quick Start

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
      geotiff: 'https://example.com/my-cog.tif'
    })
  ]
});
```

See [Examples](#examples) for complete working demos.

---

### `@developmentseed/deck.gl-geotiff`

High-level API for rendering GeoTIFFs and Cloud-Optimized GeoTIFFs in deck.gl.

#### `COGLayer`

Recommended layer for Cloud-Optimized GeoTIFFs. Leverages deck.gl's [`TileLayer`] to match the internal COG structure, automatically fetching appropriate overviews based on zoom level.

[`TileLayer`]: https://deck.gl/docs/api-reference/geo-layers/tile-layer

**Basic Usage**:

```typescript
import { COGLayer } from "@developmentseed/deck.gl-geotiff";

new COGLayer({
  id: "cog-layer",
  geotiff: "https://example.com/my-cog.tif"
});
```

**Props**:

| Prop            | Type                                                     | Description                                               |
| --------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `geotiff`       | `string \| ArrayBuffer \| Blob \| GeoTIFF \| BaseClient` | GeoTIFF source (URL, binary data, or geotiff.js instance) |
| `geoKeysParser` | `GeoKeysParser`                                          | Custom parser for GeoTIFF geo keys (default: epsg.io)     |
| `getTileData`   | `Function`                                               | Custom tile data loader (overrides default)               |
| `renderTile`    | `Function`                                               | Custom render pipeline (overrides inferred pipeline)      |


## Examples

- **[Land Cover](https://developmentseed.org/deck.gl-raster/examples/land-cover/)**: 1.3GB NLCD land cover COG with custom colormap
- **[COG Basic](https://developmentseed.org/deck.gl-raster/examples/cog-basic/)**: RGB aerial imagery with automatic reprojection

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
│  ├─ geotiff.js (COG parsing & streaming)                    │
│  └─ HTTP range requests                                     │
└─────────────────────────────────────────────────────────────┘
```

**Render Pipeline**: A composable sequence of GPU modules that transform raw raster data into displayable imagery. Pipelines are automatically inferred from GeoTIFF metadata or can be customized.

**Adaptive Mesh Reprojection**: Instead of per-pixel transformation, the library generates an adaptive triangular mesh that warps texture coordinates. This enables efficient GPU-based reprojection with minimal distortion.

**Tile Streaming**: For COGs, only the tiles visible in the current viewport are fetched. As you zoom, higher-resolution overviews are automatically loaded.

**Zero-Copy Texture Upload**: Raw raster data is uploaded directly to GPU textures, minimizing CPU-GPU transfer overhead.

