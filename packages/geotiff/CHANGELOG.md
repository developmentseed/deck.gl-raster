# Changelog

## [0.3.0-beta.2](https://github.com/developmentseed/deck.gl-raster/compare/geotiff-v0.6.0-alpha.1...geotiff-v0.3.0-beta.2) (2026-04-27)


### Features

* add zstd via fzstd ([#263](https://github.com/developmentseed/deck.gl-raster/issues/263)) ([092861f](https://github.com/developmentseed/deck.gl-raster/commit/092861f058027056e4948eac6c7bd6cdf762d85e))
* **affine:** Create new affine standalone package as port of Python affine ([ce7b73d](https://github.com/developmentseed/deck.gl-raster/commit/ce7b73de4da35449e2cd90a2563a36c7c1f70136))
* Create new `geotiff` subpackage, abstracting over `@cogeotiff/core` ([#223](https://github.com/developmentseed/deck.gl-raster/issues/223)) ([4fa5230](https://github.com/developmentseed/deck.gl-raster/commit/4fa52301173857db436d2aa4760d405d1f56119a))
* Create zarr-tileset as implementation of generic tile traversal ([#397](https://github.com/developmentseed/deck.gl-raster/issues/397)) ([bbc0731](https://github.com/developmentseed/deck.gl-raster/commit/bbc0731f8db788c7322e623a438e5f81374ac467))
* Decoder pool ([#277](https://github.com/developmentseed/deck.gl-raster/issues/277)) ([72ad1fd](https://github.com/developmentseed/deck.gl-raster/commit/72ad1fdfca40f3074bb20ce2e7bc8a0d18690885))
* feat: Add AbortSignal support to GeoTIFF.fetchTile ([9d133b8](https://github.com/developmentseed/deck.gl-raster/commit/9d133b801f181470357c39621dcac68508e4a6fe))
* **geotiff:** Add tileCount property to GeoTIFF and Overview ([#254](https://github.com/developmentseed/deck.gl-raster/issues/254)) ([c8ef424](https://github.com/developmentseed/deck.gl-raster/commit/c8ef4249f622b8e5c82960d7328241760e6ee4ff))
* **geotiff:** generate TileMatrixSet from `GeoTIFF` instance ([#235](https://github.com/developmentseed/deck.gl-raster/issues/235)) ([cb1106e](https://github.com/developmentseed/deck.gl-raster/commit/cb1106e28413bce24f993eb16e1a8b06308d0713))
* **geotiff:** High-level CRS handling from GeoTIFF GeoKeys ([#236](https://github.com/developmentseed/deck.gl-raster/issues/236)) ([559dc03](https://github.com/developmentseed/deck.gl-raster/commit/559dc03bb6ccfbc5e54fa905282d2b18130ac99d))
* **geotiff:** LZW and Predictor support ([#247](https://github.com/developmentseed/deck.gl-raster/issues/247)) ([1a2cc0e](https://github.com/developmentseed/deck.gl-raster/commit/1a2cc0eb1f9edff0105a85e75ca55eca0f34dc41))
* **geotiff:** Overhaul `GeoTIFF` and `Overview` classes ([#225](https://github.com/developmentseed/deck.gl-raster/issues/225)) ([857a8c2](https://github.com/developmentseed/deck.gl-raster/commit/857a8c2e146b06a0cdad26a85edddfef438edfcb))
* **geotiff:** Separate source for header fetches and data fetches ([#299](https://github.com/developmentseed/deck.gl-raster/issues/299)) ([93cb2ce](https://github.com/developmentseed/deck.gl-raster/commit/93cb2ce32530d35325693e2ed7de72eadacb3b60))
* **geotiff:** Support decoding JPEG and WebP-compressed COGs ([#229](https://github.com/developmentseed/deck.gl-raster/issues/229)) ([3dc6281](https://github.com/developmentseed/deck.gl-raster/commit/3dc6281c28ab654fa5304c03c3d3c4a66e19058b))
* **geotiff:** Support multi-tile fetching ([#406](https://github.com/developmentseed/deck.gl-raster/issues/406)) ([47afad5](https://github.com/developmentseed/deck.gl-raster/commit/47afad5f31659303526de86d3b9aed03f62a39d2))
* **geotiff:** Support non-boundless reads ([#250](https://github.com/developmentseed/deck.gl-raster/issues/250)) ([2f25972](https://github.com/developmentseed/deck.gl-raster/commit/2f25972df9b4e94257eaf4909a84f7b43bf04189))
* **geotiff:** User-specified prefetch size ([#256](https://github.com/developmentseed/deck.gl-raster/issues/256)) ([1794bc3](https://github.com/developmentseed/deck.gl-raster/commit/1794bc3d446e24d8aaef96f4002afbc1c38ed7cc))
* Handle GeoTIFF transparency masks ([#309](https://github.com/developmentseed/deck.gl-raster/issues/309)) ([f35df81](https://github.com/developmentseed/deck.gl-raster/commit/f35df81a5590a75e8874ac574b4dee0a41026d65))
* Initial GeoTIFF dynamic decoder API ([#226](https://github.com/developmentseed/deck.gl-raster/issues/226)) ([5d611f3](https://github.com/developmentseed/deck.gl-raster/commit/5d611f313d20e3a039288e880a413eec99b8f348))
* Offset transform by half pixel for pixel-is-point raster type ([#286](https://github.com/developmentseed/deck.gl-raster/issues/286)) ([2dc5640](https://github.com/developmentseed/deck.gl-raster/commit/2dc564095f3067b922a2b304120d22c0553a73b5))
* Overhaul to use our `geotiff` package & generic TileMatrixSet support ([#208](https://github.com/developmentseed/deck.gl-raster/issues/208)) ([860a701](https://github.com/developmentseed/deck.gl-raster/commit/860a7017d19e66b0874a9f9c064f1fa28bda8bad)), closes [#216](https://github.com/developmentseed/deck.gl-raster/issues/216)
* Parse GDAL_Metadata TIFF tag, including stored statistics and offsets/scales ([#316](https://github.com/developmentseed/deck.gl-raster/issues/316)) ([73f09f9](https://github.com/developmentseed/deck.gl-raster/commit/73f09f97b562c68ba2c17ecfebf73f1ba49b06c7))
* Support grayscale photometric interpretation ([#179](https://github.com/developmentseed/deck.gl-raster/issues/179)) ([cb612de](https://github.com/developmentseed/deck.gl-raster/commit/cb612de42970b72f1ead83edd34d158eefe8672f))
* Support lerc+deflate and lerc+zstd ([#314](https://github.com/developmentseed/deck.gl-raster/issues/314)) ([a9ab5dc](https://github.com/developmentseed/deck.gl-raster/commit/a9ab5dcce92ca0acec43f3af25bdf23192580546))
* Support reading band-interleaved COGs ([#297](https://github.com/developmentseed/deck.gl-raster/issues/297)) ([eab26e2](https://github.com/developmentseed/deck.gl-raster/commit/eab26e26764c79e31f09b7c05dd883b1bcb03d44))
* Support reading band-interleaved COGs ([#297](https://github.com/developmentseed/deck.gl-raster/issues/297)) ([880cd5b](https://github.com/developmentseed/deck.gl-raster/commit/880cd5bca7c076dca0ee08a5bc3191e09fe9a083))
* Support reading band-interleaved COGs ([#297](https://github.com/developmentseed/deck.gl-raster/issues/297)) ([2ba8164](https://github.com/developmentseed/deck.gl-raster/commit/2ba816465248bf4d17e5d6ec53b30f0209c31a17))
* Support reading band-interleaved COGs ([#297](https://github.com/developmentseed/deck.gl-raster/issues/297)) ([a21c126](https://github.com/developmentseed/deck.gl-raster/commit/a21c126d7fdd7107dca76e90a3f5d087dd8d97c3))
* Support reading band-interleaved COGs ([#297](https://github.com/developmentseed/deck.gl-raster/issues/297)) ([09bfeb9](https://github.com/developmentseed/deck.gl-raster/commit/09bfeb90901fa3d1469e1f571fbe5ff797431eb7))


### Bug Fixes

* Fix rendering of YCbCr-encoded JPEG images ([#249](https://github.com/developmentseed/deck.gl-raster/issues/249)) ([2af2a47](https://github.com/developmentseed/deck.gl-raster/commit/2af2a4795f3916a03e507c0c1d81057244ce002c))
* Force loading gdal tags (nodata and metadata) ([#308](https://github.com/developmentseed/deck.gl-raster/issues/308)) ([e237698](https://github.com/developmentseed/deck.gl-raster/commit/e2376980f79beb222c8092a6595cd2ae2febb619))
* Move `lerc` to non-dev dependencies ([#367](https://github.com/developmentseed/deck.gl-raster/issues/367)) ([3e3ee89](https://github.com/developmentseed/deck.gl-raster/commit/3e3ee89822e17cd345dd04d940c2ba65c76e5e29))
* Remove alignment workarounds, bump to deck/luma 9.3 ([#419](https://github.com/developmentseed/deck.gl-raster/issues/419)) ([535516d](https://github.com/developmentseed/deck.gl-raster/commit/535516d01787459fdc026592c49da59c2287b4f2))
* Revert default behavior to send `cache: no-cache` header ([#360](https://github.com/developmentseed/deck.gl-raster/issues/360)) ([c4137c5](https://github.com/developmentseed/deck.gl-raster/commit/c4137c5e38eb4e1517037730ee721c4e52610662))
* Turn off TIFF chunking for now ([#295](https://github.com/developmentseed/deck.gl-raster/issues/295)) ([c4996b2](https://github.com/developmentseed/deck.gl-raster/commit/c4996b2203803e20656641a55a36265174013831))


### Reverts

* "chore(deps): bump the prod-dependencies group across 1 directory with 14 updates" ([#429](https://github.com/developmentseed/deck.gl-raster/issues/429)) ([0be1eb3](https://github.com/developmentseed/deck.gl-raster/commit/0be1eb30cb927bf93556f2c5ec9a57562e452ec1))


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
