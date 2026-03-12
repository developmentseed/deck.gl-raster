# Changelog

## [0.4.0-beta.3](https://github.com/developmentseed/deck.gl-raster/compare/v0.3.0-beta.3...v0.4.0-beta.3) (2026-03-12)


### Features

* Add mesh max error slider to NLCD example ([#271](https://github.com/developmentseed/deck.gl-raster/issues/271)) ([8ab5d8a](https://github.com/developmentseed/deck.gl-raster/commit/8ab5d8a189d5d7161a9a44e1bd624d38c23e5473))
* add zstd via fzstd ([#263](https://github.com/developmentseed/deck.gl-raster/issues/263)) ([092861f](https://github.com/developmentseed/deck.gl-raster/commit/092861f058027056e4948eac6c7bd6cdf762d85e))
* Decoder pool ([#277](https://github.com/developmentseed/deck.gl-raster/issues/277)) ([72ad1fd](https://github.com/developmentseed/deck.gl-raster/commit/72ad1fdfca40f3074bb20ce2e7bc8a0d18690885))
* **geotiff:** Add tileCount property to GeoTIFF and Overview ([#254](https://github.com/developmentseed/deck.gl-raster/issues/254)) ([c8ef424](https://github.com/developmentseed/deck.gl-raster/commit/c8ef4249f622b8e5c82960d7328241760e6ee4ff))
* **geotiff:** Separate source for header fetches and data fetches ([#299](https://github.com/developmentseed/deck.gl-raster/issues/299)) ([93cb2ce](https://github.com/developmentseed/deck.gl-raster/commit/93cb2ce32530d35325693e2ed7de72eadacb3b60))
* **geotiff:** User-specified prefetch size ([#256](https://github.com/developmentseed/deck.gl-raster/issues/256)) ([1794bc3](https://github.com/developmentseed/deck.gl-raster/commit/1794bc3d446e24d8aaef96f4002afbc1c38ed7cc))
* Handle GeoTIFF transparency masks ([#309](https://github.com/developmentseed/deck.gl-raster/issues/309)) ([f35df81](https://github.com/developmentseed/deck.gl-raster/commit/f35df81a5590a75e8874ac574b4dee0a41026d65))
* New `@developmentseed/epsg` package for shipping compressed EPSG code bundle ([#262](https://github.com/developmentseed/deck.gl-raster/issues/262)) ([510498a](https://github.com/developmentseed/deck.gl-raster/commit/510498a03bded80ce9c80b22d45d4c82870af667))
* Offset transform by half pixel for pixel-is-point raster type ([#286](https://github.com/developmentseed/deck.gl-raster/issues/286)) ([2dc5640](https://github.com/developmentseed/deck.gl-raster/commit/2dc564095f3067b922a2b304120d22c0553a73b5))
* Parse GDAL_Metadata TIFF tag, including stored statistics and offsets/scales ([#316](https://github.com/developmentseed/deck.gl-raster/issues/316)) ([73f09f9](https://github.com/developmentseed/deck.gl-raster/commit/73f09f97b562c68ba2c17ecfebf73f1ba49b06c7))
* Support grayscale photometric interpretation ([#179](https://github.com/developmentseed/deck.gl-raster/issues/179)) ([cb612de](https://github.com/developmentseed/deck.gl-raster/commit/cb612de42970b72f1ead83edd34d158eefe8672f))
* Support lerc+deflate and lerc+zstd ([#314](https://github.com/developmentseed/deck.gl-raster/issues/314)) ([a9ab5dc](https://github.com/developmentseed/deck.gl-raster/commit/a9ab5dcce92ca0acec43f3af25bdf23192580546))
* Support reading band-interleaved COGs ([#297](https://github.com/developmentseed/deck.gl-raster/issues/297)) ([eab26e2](https://github.com/developmentseed/deck.gl-raster/commit/eab26e26764c79e31f09b7c05dd883b1bcb03d44))
* Support reading band-interleaved COGs ([#297](https://github.com/developmentseed/deck.gl-raster/issues/297)) ([880cd5b](https://github.com/developmentseed/deck.gl-raster/commit/880cd5bca7c076dca0ee08a5bc3191e09fe9a083))
* Support reading band-interleaved COGs ([#297](https://github.com/developmentseed/deck.gl-raster/issues/297)) ([2ba8164](https://github.com/developmentseed/deck.gl-raster/commit/2ba816465248bf4d17e5d6ec53b30f0209c31a17))
* Support reading band-interleaved COGs ([#297](https://github.com/developmentseed/deck.gl-raster/issues/297)) ([a21c126](https://github.com/developmentseed/deck.gl-raster/commit/a21c126d7fdd7107dca76e90a3f5d087dd8d97c3))
* Support reading band-interleaved COGs ([#297](https://github.com/developmentseed/deck.gl-raster/issues/297)) ([09bfeb9](https://github.com/developmentseed/deck.gl-raster/commit/09bfeb90901fa3d1469e1f571fbe5ff797431eb7))
* Update `cog-basic` example app with drop-down image selector ([#323](https://github.com/developmentseed/deck.gl-raster/issues/323)) ([f7b47bc](https://github.com/developmentseed/deck.gl-raster/commit/f7b47bc9d56e5427946ba065708a93c7acee955f))


### Bug Fixes

* Avoid unnecessarily calling `inferDefaultPipeline` ([#307](https://github.com/developmentseed/deck.gl-raster/issues/307)) ([09cfe1b](https://github.com/developmentseed/deck.gl-raster/commit/09cfe1bfb128632714a18ada87027bf73321a910))
* Ensure 4-byte alignment on texture buffers ([#289](https://github.com/developmentseed/deck.gl-raster/issues/289)) ([7e31f31](https://github.com/developmentseed/deck.gl-raster/commit/7e31f31f260a75a28fc7a229079010b406a12cdb))
* Fix `TileMatrixSetTileset` projected bounds computation for each tile ([#274](https://github.com/developmentseed/deck.gl-raster/issues/274)) ([ce0bb09](https://github.com/developmentseed/deck.gl-raster/commit/ce0bb09b58d517eebc5693c86fea0984ea749446))
* Fix adding alpha channel to uint16 image ([#318](https://github.com/developmentseed/deck.gl-raster/issues/318)) ([a374a55](https://github.com/developmentseed/deck.gl-raster/commit/a374a55389a0b26a622970af53486b666e7e60a5))
* Fix declared luma.gl dependency ([#265](https://github.com/developmentseed/deck.gl-raster/issues/265)) ([f5c57df](https://github.com/developmentseed/deck.gl-raster/commit/f5c57dfd7a11d97a847888b136dd0c5ae95e4a0c))
* Fix passing general layer props down to RasterLayer ([#329](https://github.com/developmentseed/deck.gl-raster/issues/329)) ([a00835d](https://github.com/developmentseed/deck.gl-raster/commit/a00835db51b64cf00505ffc792580c99001f3bff))
* Force loading gdal tags (nodata and metadata) ([#308](https://github.com/developmentseed/deck.gl-raster/issues/308)) ([e237698](https://github.com/developmentseed/deck.gl-raster/commit/e2376980f79beb222c8092a6595cd2ae2febb619))
* Turn off TIFF chunking for now ([#295](https://github.com/developmentseed/deck.gl-raster/issues/295)) ([c4996b2](https://github.com/developmentseed/deck.gl-raster/commit/c4996b2203803e20656641a55a36265174013831))
* Update naip-mosaic example to use our `geotiff` package ([#293](https://github.com/developmentseed/deck.gl-raster/issues/293)) ([73c1a1e](https://github.com/developmentseed/deck.gl-raster/commit/73c1a1e0d6c2bc7d9ae1f9ee352abb5c2065679e))

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
