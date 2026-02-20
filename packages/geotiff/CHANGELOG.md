# Changelog

## [0.3.0-beta.2](https://github.com/developmentseed/deck.gl-raster/compare/geotiff-v0.3.0-beta.3...geotiff-v0.3.0-beta.2) (2026-02-20)


### Features

* **affine:** Create new affine standalone package as port of Python affine ([ce7b73d](https://github.com/developmentseed/deck.gl-raster/commit/ce7b73de4da35449e2cd90a2563a36c7c1f70136))
* Create new `geotiff` subpackage, abstracting over `@cogeotiff/core` ([#223](https://github.com/developmentseed/deck.gl-raster/issues/223)) ([4fa5230](https://github.com/developmentseed/deck.gl-raster/commit/4fa52301173857db436d2aa4760d405d1f56119a))
* feat: Add AbortSignal support to GeoTIFF.fetchTile ([9d133b8](https://github.com/developmentseed/deck.gl-raster/commit/9d133b801f181470357c39621dcac68508e4a6fe))
* **geotiff:** Add tileCount property to GeoTIFF and Overview ([#254](https://github.com/developmentseed/deck.gl-raster/issues/254)) ([c8ef424](https://github.com/developmentseed/deck.gl-raster/commit/c8ef4249f622b8e5c82960d7328241760e6ee4ff))
* **geotiff:** generate TileMatrixSet from `GeoTIFF` instance ([#235](https://github.com/developmentseed/deck.gl-raster/issues/235)) ([cb1106e](https://github.com/developmentseed/deck.gl-raster/commit/cb1106e28413bce24f993eb16e1a8b06308d0713))
* **geotiff:** High-level CRS handling from GeoTIFF GeoKeys ([#236](https://github.com/developmentseed/deck.gl-raster/issues/236)) ([559dc03](https://github.com/developmentseed/deck.gl-raster/commit/559dc03bb6ccfbc5e54fa905282d2b18130ac99d))
* **geotiff:** LZW and Predictor support ([#247](https://github.com/developmentseed/deck.gl-raster/issues/247)) ([1a2cc0e](https://github.com/developmentseed/deck.gl-raster/commit/1a2cc0eb1f9edff0105a85e75ca55eca0f34dc41))
* **geotiff:** Overhaul `GeoTIFF` and `Overview` classes ([#225](https://github.com/developmentseed/deck.gl-raster/issues/225)) ([857a8c2](https://github.com/developmentseed/deck.gl-raster/commit/857a8c2e146b06a0cdad26a85edddfef438edfcb))
* **geotiff:** Support decoding JPEG and WebP-compressed COGs ([#229](https://github.com/developmentseed/deck.gl-raster/issues/229)) ([3dc6281](https://github.com/developmentseed/deck.gl-raster/commit/3dc6281c28ab654fa5304c03c3d3c4a66e19058b))
* **geotiff:** Support non-boundless reads ([#250](https://github.com/developmentseed/deck.gl-raster/issues/250)) ([2f25972](https://github.com/developmentseed/deck.gl-raster/commit/2f25972df9b4e94257eaf4909a84f7b43bf04189))
* **geotiff:** User-specified prefetch size ([#256](https://github.com/developmentseed/deck.gl-raster/issues/256)) ([1794bc3](https://github.com/developmentseed/deck.gl-raster/commit/1794bc3d446e24d8aaef96f4002afbc1c38ed7cc))
* Initial GeoTIFF dynamic decoder API ([#226](https://github.com/developmentseed/deck.gl-raster/issues/226)) ([5d611f3](https://github.com/developmentseed/deck.gl-raster/commit/5d611f313d20e3a039288e880a413eec99b8f348))
* Overhaul to use our `geotiff` package & generic TileMatrixSet support ([#208](https://github.com/developmentseed/deck.gl-raster/issues/208)) ([860a701](https://github.com/developmentseed/deck.gl-raster/commit/860a7017d19e66b0874a9f9c064f1fa28bda8bad)), closes [#216](https://github.com/developmentseed/deck.gl-raster/issues/216)


### Bug Fixes

* Fix rendering of YCbCr-encoded JPEG images ([#249](https://github.com/developmentseed/deck.gl-raster/issues/249)) ([2af2a47](https://github.com/developmentseed/deck.gl-raster/commit/2af2a4795f3916a03e507c0c1d81057244ce002c))


### Miscellaneous Chores

* release 0.3.0-beta.1 ([#239](https://github.com/developmentseed/deck.gl-raster/issues/239)) ([8ba364e](https://github.com/developmentseed/deck.gl-raster/commit/8ba364e3ba50fffc9927ef5a07da9f5d4add78d8))

## [0.3.0-beta.2](https://github.com/developmentseed/deck.gl-raster/compare/geotiff-v0.3.0-beta.1...geotiff-v0.3.0-beta.2) (2026-02-19)


### Features

* feat: Add AbortSignal support to GeoTIFF.fetchTile ([9d133b8](https://github.com/developmentseed/deck.gl-raster/commit/9d133b801f181470357c39621dcac68508e4a6fe))

## 0.3.0-beta.1 (2026-02-18)


### Features

* **affine:** Create new affine standalone package as port of Python affine ([ce7b73d](https://github.com/developmentseed/deck.gl-raster/commit/ce7b73de4da35449e2cd90a2563a36c7c1f70136))
* Create new `geotiff` subpackage, abstracting over `@cogeotiff/core` ([#223](https://github.com/developmentseed/deck.gl-raster/issues/223)) ([4fa5230](https://github.com/developmentseed/deck.gl-raster/commit/4fa52301173857db436d2aa4760d405d1f56119a))
* **geotiff:** generate TileMatrixSet from `GeoTIFF` instance ([#235](https://github.com/developmentseed/deck.gl-raster/issues/235)) ([cb1106e](https://github.com/developmentseed/deck.gl-raster/commit/cb1106e28413bce24f993eb16e1a8b06308d0713))
* **geotiff:** High-level CRS handling from GeoTIFF GeoKeys ([#236](https://github.com/developmentseed/deck.gl-raster/issues/236)) ([559dc03](https://github.com/developmentseed/deck.gl-raster/commit/559dc03bb6ccfbc5e54fa905282d2b18130ac99d))
* **geotiff:** Overhaul `GeoTIFF` and `Overview` classes ([#225](https://github.com/developmentseed/deck.gl-raster/issues/225)) ([857a8c2](https://github.com/developmentseed/deck.gl-raster/commit/857a8c2e146b06a0cdad26a85edddfef438edfcb))
* **geotiff:** Support decoding JPEG and WebP-compressed COGs ([#229](https://github.com/developmentseed/deck.gl-raster/issues/229)) ([3dc6281](https://github.com/developmentseed/deck.gl-raster/commit/3dc6281c28ab654fa5304c03c3d3c4a66e19058b))
* Initial GeoTIFF dynamic decoder API ([#226](https://github.com/developmentseed/deck.gl-raster/issues/226)) ([5d611f3](https://github.com/developmentseed/deck.gl-raster/commit/5d611f313d20e3a039288e880a413eec99b8f348))
* Overhaul to use our `geotiff` package & generic TileMatrixSet support ([#208](https://github.com/developmentseed/deck.gl-raster/issues/208)) ([860a701](https://github.com/developmentseed/deck.gl-raster/commit/860a7017d19e66b0874a9f9c064f1fa28bda8bad)), closes [#216](https://github.com/developmentseed/deck.gl-raster/issues/216)


### Miscellaneous Chores

* release 0.3.0-beta.1 ([#239](https://github.com/developmentseed/deck.gl-raster/issues/239)) ([8ba364e](https://github.com/developmentseed/deck.gl-raster/commit/8ba364e3ba50fffc9927ef5a07da9f5d4add78d8))
