# Changelog

## [0.3.0](https://github.com/developmentseed/deck.gl-raster/compare/v0.2.0...v0.3.0) (2026-02-14)


### Features

* **affine:** Create new `affine` standalone package as port of Python `affine` ([#224](https://github.com/developmentseed/deck.gl-raster/issues/224)) ([ce7b73d](https://github.com/developmentseed/deck.gl-raster/commit/ce7b73de4da35449e2cd90a2563a36c7c1f70136))
* Create new `geotiff` subpackage, abstracting over `@cogeotiff/core` ([#223](https://github.com/developmentseed/deck.gl-raster/issues/223)) ([4fa5230](https://github.com/developmentseed/deck.gl-raster/commit/4fa52301173857db436d2aa4760d405d1f56119a))
* **geotiff:** Overhaul `GeoTIFF` and `Overview` classes ([#225](https://github.com/developmentseed/deck.gl-raster/issues/225)) ([857a8c2](https://github.com/developmentseed/deck.gl-raster/commit/857a8c2e146b06a0cdad26a85edddfef438edfcb))
* **geotiff:** Support decoding JPEG and WebP-compressed COGs ([#229](https://github.com/developmentseed/deck.gl-raster/issues/229)) ([3dc6281](https://github.com/developmentseed/deck.gl-raster/commit/3dc6281c28ab654fa5304c03c3d3c4a66e19058b))
* Initial GeoTIFF dynamic decoder API ([#226](https://github.com/developmentseed/deck.gl-raster/issues/226)) ([5d611f3](https://github.com/developmentseed/deck.gl-raster/commit/5d611f313d20e3a039288e880a413eec99b8f348))


### Bug Fixes

* Fix shader caching ([#221](https://github.com/developmentseed/deck.gl-raster/issues/221)) ([2a02439](https://github.com/developmentseed/deck.gl-raster/commit/2a02439b465a4bf0596875fefec2d8b378ed8691))

## [0.2.0](https://github.com/developmentseed/deck.gl-raster/compare/v0.1.0...v0.2.0) (2026-01-26)


### Features

* Mosaic tile layer ([#184](https://github.com/developmentseed/deck.gl-raster/issues/184)) ([acc6904](https://github.com/developmentseed/deck.gl-raster/commit/acc6904fe67e2a8549ce8e17522d20578eab1749))
* Update land-cover example text ([#163](https://github.com/developmentseed/deck.gl-raster/issues/163)) ([790b5f5](https://github.com/developmentseed/deck.gl-raster/commit/790b5f5d44562f5a4c819ede644832558773d18e))


### Bug Fixes

* handle lowercase units ([#195](https://github.com/developmentseed/deck.gl-raster/issues/195)) ([918c241](https://github.com/developmentseed/deck.gl-raster/commit/918c241b2c758694c899310dc9225d3675e6df00))


### Performance Improvements

* remove unnecessary object creation ([#181](https://github.com/developmentseed/deck.gl-raster/issues/181)) ([62c0c23](https://github.com/developmentseed/deck.gl-raster/commit/62c0c2304a7a2d6594c3c7595ed298dca40ac7d9))

## Changelog

## 0.1.0 - 2026-01-07

Initial release to NPM.
