---
slug: multi-band-cog
title: Multi-band COG support
date: 2026-04-16
authors:
  - kylebarron
tags: [release]
image: ../static/img/sentinel-2-examples-card.jpg
---

deck.gl-raster now supports rendering multi-band [Cloud-Optimized GeoTIFFs][cogeo] (COGs), commonly found for satellite imagery data like Landsat or Sentinel-2, all **without a server**. [See hosted example][sentinel-2-example].

[cogeo]: https://cogeo.org/

[![](../static/img/sentinel-2-examples-card.jpg)][sentinel-2-example]

[sentinel-2-example]: https://developmentseed.org/deck.gl-raster/examples/sentinel-2/

{/* truncate */}

## Multi-band COG support

Many COGs are distributed as a collection of multiple inter-related files, where they all represent the same scene with the same spatial extent. For example, [Sentinel-2][s2-aws-bucket] or [Landsat](https://registry.opendata.aws/usgs-landsat/) images are distributed in this type of COG layout.

We have a new [`MultiCOGLayer`] to support rendering this type of COG source. This layer is intended to be used whenever multiple separate COG files represent **one single composite image**. If you want to render multiple image sources as a mosaic, use the [`MosaicLayer`].

[s2-aws-bucket]: https://registry.opendata.aws/sentinel-2-l2a-cogs/
[`MultiCOGLayer`]: https://developmentseed.org/deck.gl-raster/api/deck-gl-geotiff/classes/MultiCOGLayer/
[`MosaicLayer`]: https://developmentseed.org/deck.gl-raster/api/deck-gl-geotiff/classes/MosaicLayer/

The `MultiCOGLayer` abstracts many technical implementation details away from the end user. When the source has bands at different resolutions, it will automatically resample across mixed band resolutions — _all on the GPU_.

For example, consider rendering a Sentinel-2 vegetation composite with the near-infrared, short-wave infrared, and red bands. The short-wave band's finest pixel resolution is 20 meters while the other bands have a finest pixel resolution of 10 meters. The `MultiCOGLayer` will _automatically upsample_ the short-wave infrared band up to 10m so that the three can be rendered together at full resolution.

We have a [new example application][sentinel-2-example] to visualize various selected Sentinel-2 scenes, directly from the [Sentinel-2 AWS Open Data bucket][s2-aws-bucket]. Below are screenshots from this example application.

[![](../static/img/sentinel-2-examples-card.jpg)][sentinel-2-example]
Torres del Paine, Chile: Infrared False Color composite

[![](../static/img/sentinel-2-sossusvlei.jpg)][sentinel-2-example]
Sossusvlei, Namibia: Agriculture composite

[![](../static/img/sentinel-2-kamchatka.jpg)][sentinel-2-example]
Kamchatka, Russia: Vegetation composite

[![](../static/img/sentinel-2-mt-etna.jpg)][sentinel-2-example]
Mt Etna, Italy: SWIR composite

[![](../static/img/sentinel-2-nile-delta.jpg)][sentinel-2-example]
Nile Delta, Egypt: Agriculture composite

[sentinel-2-example]: https://developmentseed.org/deck.gl-raster/examples/sentinel-2/

## Fix "muted" colors

Previously we had unintentionally been "muting" colors. This is now fixed to default to rendering input colors as-is without any additional post-processing.

| Before                                      | After                                       |
| ------------------------------------------- | ------------------------------------------- |
| ![](../static/img/material-default-old.jpg) | ![](../static/img/material-default-new.jpg) |

This was happening because deck.gl applied a default [`Material`](https://deck.gl/docs/developer-guide/using-effects#material-settings) to renderings. This is useful for 3D visualizations, but in our case it makes more sense to turn the material off by default.

## Support deck.gl v9.3

In order to support the recent [deck.gl v9.3 release](https://deck.gl/docs/whats-new#deckgl-v93), we removed some previous workarounds around WebGL texture byte alignment. See [#419](https://github.com/developmentseed/deck.gl-raster/pull/419) for more information.

## Internal refactors for future Zarr & GeoZarr support

Previously, the internal "tile traversal" code, which tells deck.gl where to render each tile loaded from an image source, was tied to Cloud-Optimized GeoTIFFs and the [Tile Matrix Set specification](https://www.ogc.org/standards/tms).

We performed some [internal](https://github.com/developmentseed/deck.gl-raster/pull/391) [refactors](https://github.com/developmentseed/deck.gl-raster/pull/394) to generalize this interface. We now have an initial functional prototype of [GeoZarr](https://geozarr.org/) rendering, which will be properly released soon.
