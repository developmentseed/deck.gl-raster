---
slug: todo
title: COG latency improvements
date: 2026-05-12
authors:
  - kylebarron
tags: [release]
image: ../static/img/sentinel-2-examples-card.jpg
---

We have se

A new `ZarrLayer` now supports rendering and animating [Zarr] and [GeoZarr] datasets in [deck.gl]. This is GPU-based and fully client-side, **without a server**. [See example][dynamical-example].


[Zarr]: https://zarr.dev/
[deck.gl]: https://deck.gl/
[GeoZarr]: https://geozarr.org/
[dynamical-example]: https://developmentseed.org/deck.gl-raster/examples/dynamical-zarr-ecmwf/

{/* truncate */}

## Fixed tile selection on high-resolution displays



| Before | After |
| -- | -- |
| ![](../static/img/high-dpi-fix-before2.jpg) | ![](../static/img/high-dpi-fix-after2.jpg) |

We now respect the [`Deck.useDevicePixels` parameter](https://deck.gl/docs/api-reference/core/deck#usedevicepixels).

In technical terms, this means that the resolution of tiles chosen for display matches the _physical_ pixel resolution of your display, not the CSS pixel resolution.

This applies to both the COGLayer and the ZarrLayer (when the Zarr source supplies multiscales).

## Big latency improvement for large COG

* perf(geotiff)!: block-aligned LRU header cache; lazy tile metadata by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/529

## Updated Example: Categorical land cover filtering

 Filterable categories


## New Example: Swipe comparsion of 200GB COGs

200GB COG

Vermont open data example


### Bug Fixes

* fix!: Default to linear sampling for non-paletted COGs by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/514
* fix(examples): correct NDVI range filter in naip-mosaic by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/522

### Performance Improvements

* feat(geotiff): New internal method to fetch multiple tiles concurrently, with range coalescing by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/530
* fix(raster-tileset): memoize tile bounding volumes across traversals by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/525

