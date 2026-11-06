# @developmentseed/deck.gl-raster

Core primitives for rendering georeferenced image data.

This image data can come from _any_ source. You only need to provide functions for associating pixel positions with spatial positions.

Users with Cloud-Optimized GeoTIFF data should use the higher-level [`COGLayer`](https://developmentseed.org/deck.gl-raster/api/deck-gl-geotiff/classes/COGLayer/) from the `@developmentseed/deck.gl-geotiff` package instead, and users with Zarr data the [`ZarrLayer`](https://developmentseed.org/deck.gl-raster/api/deck-gl-zarr/classes/ZarrLayer/) from `@developmentseed/deck.gl-zarr`.

## Install

```bash
npm install @developmentseed/deck.gl-raster
```
