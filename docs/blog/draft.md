---
slug: v0-7-release
title: deck.gl-raster v0.7
date: 2026-05-15
authors:
  - kylebarron
tags: [release]
image: ../static/img/sentinel-2-examples-card.jpg
---

deck.gl-raster enables GPU-accelerated [Cloud-Optimized GeoTIFF][cogeo] (COG) and [Zarr] visualization in [deck.gl].

**TODO: update file name**

**TODO: update summary**

This release includes big performance improvements

[cogeo]: https://cogeo.org/
[Zarr]: https://zarr.dev/
[deck.gl]: https://deck.gl/

{/* truncate */}

## Performance improvements

### Faster GPU updates for pixel filtering

**TODO: update description**

Applies to both the COGLayer and the ZarrLayer.

**Before:**

![](../static/img/pixel-filter-gpu-update-before.gif)

**After:**

![](../static/img/pixel-filter-gpu-update-after.gif)


See [#543](https://github.com/developmentseed/deck.gl-raster/pull/543) and [#540](https://github.com/developmentseed/deck.gl-raster/pull/540) for more details.

### Big latency improvement for large COGs

We've updated [our GeoTIFF reader](https://developmentseed.org/deck.gl-raster/api/geotiff/) to reduce the number of header requests required to start rendering a COG.

In our [Vermont Aerial Imagery example](https://developmentseed.org/deck.gl-raster/examples/vermont-cog-comparison/), for a **200 gigabyte COG**, we fetch only **256 kilobytes** of metadata before starting to load image tiles.

This screencast from that example simulates loading a 200GB COG (on the right) and a 50GB COG (on the left) over a 20MB/s internet connection with caching disabled:

![](../static/img/latency-improvement-large-cog.gif)

See [#529](https://github.com/developmentseed/deck.gl-raster/pull/529) for more information.

### Faster tile traversal

**TODO: update or remove**

* fix(raster-tileset): memoize tile bounding volumes across traversals by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/525

## Spiral image loading instead of top-left

We now load tiles starting from the center of the viewport.

_(Tile loading in this screencast was artificially slowed down for effect.)_

![](../static/img/tile-loading-spiral.gif)

See [#477](https://github.com/developmentseed/deck.gl-raster/pull/477) for more details.

## Fixed tile selection on high-resolution displays

We now ensure that COG overview and Zarr multiscale selection matches the pixel density of your display. We **now render 4x as many pixels** on modern displays like Mac Retina displays.

Here's a comparison from our [NAIP example](https://developmentseed.org/deck.gl-raster/examples/naip-mosaic/). Notice how much more crisp the image is now.

**Before:**

![](../static/img/high-dpi-fix-before2.jpg)

**After:**

![](../static/img/high-dpi-fix-after2.jpg)

Previously we had been using the number of CSS pixels, which is not the same as the size of the GPU drawing buffer.

This means that for high-resolution screens like Mac Retina displays, **4x more image tiles** will now be loaded compared to before. We respect the [`Deck.useDevicePixels` parameter](https://deck.gl/docs/api-reference/core/deck#usedevicepixels), so you can turn that to `false` if you want to revert to the old behavior.

See [#513](https://github.com/developmentseed/deck.gl-raster/pull/513) for more details.

## Updated Examples

### Categorical land cover filtering

We've updated the existing [NLCD Land Cover example](https://developmentseed.org/deck.gl-raster/examples/land-cover/) to filter pixels by their classification. All pixel filtering happens on the fly on the GPU.

![](../static/img/land-cover-categories.gif)

See [#506](https://github.com/developmentseed/deck.gl-raster/pull/506) for more details.

### Side-by-side image comparsion

As alluded to in our [performance section above](#big-latency-improvement-for-large-cogs), we have [a new example](https://developmentseed.org/deck.gl-raster/examples/vermont-cog-comparison/) that shows one method for "left/right image comparisons" with deck.gl-raster.

![](../static/img/vermont-swipe-example.gif)

See [#502](https://github.com/developmentseed/deck.gl-raster/pull/502) for more details.

## MosaicLayer improvements

### Sources prop now reactive to changing input

**TODO: update**

     * List of mosaic sources to render.
     *
     * The mosaic updates reactively when this prop is replaced with a new
     * array reference. Mutating the array in place will not trigger an
     * update — pass a fresh array (e.g. `[...sources, newItem]`) to add or
     * remove items.
     *
     * Tile cache reuse depends on stable tile IDs. By default, each source's
     * tile ID is derived from its position in this array (see
     * `MosaicSource.key`), so:
     *
     * - Appending items preserves all existing rendered tiles.
     * - Reordering or removing items from the middle of the array invalidates
     *   the cache slots of shifted items, causing them to re-fetch.
     *
     * Supply an explicit `key` per source if you need cache stability across
     * arbitrary mutations of `sources`.
     */

### Caching improvements

Use the `id` attribute on each input source. in case you change the mosaic sources on the fly. This ensures that any existing layers are maintained across updates.
