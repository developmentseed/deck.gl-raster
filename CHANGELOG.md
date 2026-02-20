# Changelog

## [0.4.0-beta.3](https://github.com/developmentseed/deck.gl-raster/compare/v0.3.0-beta.3...v0.4.0-beta.3) (2026-02-20)


### Features

* **geotiff:** Add tileCount property to GeoTIFF and Overview ([#254](https://github.com/developmentseed/deck.gl-raster/issues/254)) ([c8ef424](https://github.com/developmentseed/deck.gl-raster/commit/c8ef4249f622b8e5c82960d7328241760e6ee4ff))
* **geotiff:** User-specified prefetch size ([#256](https://github.com/developmentseed/deck.gl-raster/issues/256)) ([1794bc3](https://github.com/developmentseed/deck.gl-raster/commit/1794bc3d446e24d8aaef96f4002afbc1c38ed7cc))

## [0.3.0-beta.2](https://github.com/developmentseed/deck.gl-raster/compare/v0.3.0-beta.1...v0.3.0-beta.2) (2026-02-19)


### Features

* feat: Add AbortSignal support to GeoTIFF.fetchTile ([9d133b8](https://github.com/developmentseed/deck.gl-raster/commit/9d133b801f181470357c39621dcac68508e4a6fe))

## [0.3.0-beta.1](https://github.com/developmentseed/deck.gl-raster/compare/v0.2.0...v0.3.0-beta.1) (2026-02-18)


### Features

* **affine:** Create new affine standalone package as port of Python affine ([ce7b73d](https://github.com/developmentseed/deck.gl-raster/commit/ce7b73de4da35449e2cd90a2563a36c7c1f70136))
* Create `morecantile` subpackage ([#238](https://github.com/developmentseed/deck.gl-raster/issues/238)) ([20b3ace](https://github.com/developmentseed/deck.gl-raster/commit/20b3ace5de34ea91848e2f1f5b7d6565d245e01e))
* Create new `geotiff` subpackage, abstracting over `@cogeotiff/core` ([#223](https://github.com/developmentseed/deck.gl-raster/issues/223)) ([4fa5230](https://github.com/developmentseed/deck.gl-raster/commit/4fa52301173857db436d2aa4760d405d1f56119a))
* **geotiff:** generate TileMatrixSet from `GeoTIFF` instance ([#235](https://github.com/developmentseed/deck.gl-raster/issues/235)) ([cb1106e](https://github.com/developmentseed/deck.gl-raster/commit/cb1106e28413bce24f993eb16e1a8b06308d0713))
* **geotiff:** High-level CRS handling from GeoTIFF GeoKeys ([#236](https://github.com/developmentseed/deck.gl-raster/issues/236)) ([559dc03](https://github.com/developmentseed/deck.gl-raster/commit/559dc03bb6ccfbc5e54fa905282d2b18130ac99d))
* **geotiff:** Overhaul `GeoTIFF` and `Overview` classes ([#225](https://github.com/developmentseed/deck.gl-raster/issues/225)) ([857a8c2](https://github.com/developmentseed/deck.gl-raster/commit/857a8c2e146b06a0cdad26a85edddfef438edfcb))
* **geotiff:** Support decoding JPEG and WebP-compressed COGs ([#229](https://github.com/developmentseed/deck.gl-raster/issues/229)) ([3dc6281](https://github.com/developmentseed/deck.gl-raster/commit/3dc6281c28ab654fa5304c03c3d3c4a66e19058b))
* Initial GeoTIFF dynamic decoder API ([#226](https://github.com/developmentseed/deck.gl-raster/issues/226)) ([5d611f3](https://github.com/developmentseed/deck.gl-raster/commit/5d611f313d20e3a039288e880a413eec99b8f348))
* Overhaul to use our `geotiff` package & generic TileMatrixSet support ([#208](https://github.com/developmentseed/deck.gl-raster/issues/208)) ([860a701](https://github.com/developmentseed/deck.gl-raster/commit/860a7017d19e66b0874a9f9c064f1fa28bda8bad)), closes [#216](https://github.com/developmentseed/deck.gl-raster/issues/216)


### Bug Fixes

* Fix shader caching ([#221](https://github.com/developmentseed/deck.gl-raster/issues/221)) ([2a02439](https://github.com/developmentseed/deck.gl-raster/commit/2a02439b465a4bf0596875fefec2d8b378ed8691))


### Miscellaneous Chores

* release 0.3.0-beta.1 ([#239](https://github.com/developmentseed/deck.gl-raster/issues/239)) ([8ba364e](https://github.com/developmentseed/deck.gl-raster/commit/8ba364e3ba50fffc9927ef5a07da9f5d4add78d8))

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
