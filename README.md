# deck.gl-raster

GPU-accelerated [GeoTIFF][geotiff], [Cloud-Optimized GeoTIFF][cogeo] (COG), and, soon, [Zarr] visualization in [deck.gl].

Fully client-side with direct image loading, no server required.

[geotiff]: https://en.wikipedia.org/wiki/GeoTIFF
[cogeo]: https://cogeo.org/
[deck.gl]: https://deck.gl/
[Zarr]: https://zarr.dev/

[![](./assets/land-cover.jpg)](https://developmentseed.org/deck.gl-raster/)

<p style="text-align: center;"><em><b>1.3GB</b> Land Cover COG rendered with <b>no server</b>.</em></p>

## Features

- Client-side GeoTIFF and Cloud-Optimized GeoTIFF visualization with no server required.
- GPU-based raster reprojection supports imagery from most projections [^1]
- Intelligent COG rendering, only fetching the relevant portions of the image required for the current view.
- Supports all GeoTIFFs defined by a linear geotransform (excludes those using Ground Control Points).
- Future: GPU-based color mapping and band math.

[^1]: The raster reprojection has not been tested on polar projections or when spanning the antimeridian.

## Packages

This monorepo contains the following packages, each of which are published to NPM:

- [`@developmentseed/deck.gl-geotiff`](#developmentseeddeckgl-geotiff)
- [`@developmentseed/deck.gl-zarr`](#developmentseeddeckgl-zarr)
- [`@developmentseed/deck.gl-raster`](#developmentseeddeckgl-raster)
- [`@developmentseed/raster-reproject`](#developmentseedraster-reproject)


### `@developmentseed/deck.gl-geotiff`

The high-level API for rendering GeoTIFFs and Cloud-Optimized GeoTIFFs in deck.gl.

#### `COGLayer`

A deck.gl layer for rendering a Cloud-Optimized GeoTIFF.

Internally, this uses a deck.gl [`TileLayer`] that matches the internal structure of the COG. When zoomed out, the COGLayer will automatically fetch the lowest-resolution overviews of the image. As you zoom in, deck.gl will automatically fetch and render tiles from the higher-resolution overviews of the image.

[`TileLayer`]: https://deck.gl/docs/api-reference/geo-layers/tile-layer

```ts
import { fromUrl } from "geotiff";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";

const url = "https://example.com/my-cog.tif"
const geotiff = await fromUrl(url);

const deckLayer = new COGLayer({
    id: "cog-layer",
    geotiff,
});
```

This will work out of the box when the provided image is an RGB image. In particular, the COGLayer defaults to calling `geotiff.js`' `readRGB` method for each tile. To override how an RGB image is generated for display, pass in a custom handler to the `loadTexture` prop.

This layer will use the internal tiling of the COG to only load the portions of the image required for the current view.

#### `GeoTIFFLayer`

In contrast to the COGLayer, this does not exploit the internal tiling of a COG. Instead, it will attempt to load the entire full-resolution image at once and render it using a single `RasterLayer`.

### `@developmentseed/deck.gl-zarr`

> _A work in progress_. Create an issue if you'd like to help implement this.

A compatibility layer on top of `@developmentseed/deck.gl-raster` to load and render tiled Zarr datasets.

This is planned to connect [zarrita.js] to the existing raster reprojection and rendering code.

[zarrita.js]: https://zarrita.dev/

### `@developmentseed/deck.gl-raster`

There are two primary exports here: `RasterLayer` and `RasterTileset2D`.

#### `RasterLayer`

A generic deck.gl layer for rendering geospatial raster data from an arbitrary source.

### `@developmentseed/raster-reproject`

The primary export is `RasterReprojector`.

_Blog post forthcoming_ to explain how `RasterReprojector` works.

This has **no dependencies** and could maybe be used by other projects like Maplibre GL JS in the future.
