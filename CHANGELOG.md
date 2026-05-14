# Changelog

## Unreleased

* feat: Web Mercator axis-aligned cutline support by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/424

## v0.6.1 - 2026-04-29

feat: Allow `renderTile` prop in `RasterTileLayer` to return `null`

## v0.6.0 - 2026-04-29

### New Features

* Zarr support:
    * feat: Create `@developmentseed/geozarr` package and define zod schema by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/395
    * feat: Create zarr-tileset as implementation of generic tile traversal by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/397
    * feat: Initial, most basic GeoZarr example by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/399
    * feat: Zarr temporal animation by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/445
    * feat: Zarr AEF example by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/467
* feat: Sprite-based colormap by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/447
    * feat: Support reversing colormaps on the GPU by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/446
    * feat: Update naip-mosaic example with choice of colormap by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/460
* refactor: Create `RasterTileLayer` abstraction in `deck.gl-raster` package by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/462
* feat: Split COG tile traversal off TileMatrixSet by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/480

### Fixes

* fix: Define texture2darray precision in colormap module by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/459
* fix: Handle EPSG:4326 projection with missing `units` by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/473
* fix: Allow `MinimalTileData` to be `null` in RasterTileLayer by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/484

### Performance

* perf: Cull root tiles in raster-tileset to viewport by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/464
* perf: use source.coop proxy for dynamical Zarr example by @alukach in https://github.com/developmentseed/deck.gl-raster/pull/471
* perf: Don't dynamic-import builtin deflate decoder by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/483

### Documentation

* docs: Expose Zarr package through docs site by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/486
* docs: inject Plausible analytics into example sites via CI by @aboydnw in https://github.com/developmentseed/deck.gl-raster/pull/478

### Other

* feat: Brainstorming for COG GCPs support by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/485
* chore: Fix `clean` script, fix lockfile by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/481
* chore: Remove usage of deprecated deck.gl enum by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/474

### New Contributors

* @alukach made their first contribution in https://github.com/developmentseed/deck.gl-raster/pull/471
* @jcoyne made their first contribution in https://github.com/developmentseed/deck.gl-raster/pull/468

**Full Changelog**: https://github.com/developmentseed/deck.gl-raster/compare/v0.5.0...v0.6.0

## v0.5.0 - 2026-04-16

### Breaking Changes

* refactor!: Generalize tile traversal interface by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/391 and refactor(deck.gl-raster)!: Finish generalizing tile traversal by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/394
    * This is only a breaking change if you were using the low-level tile traversal primitives exported by `@developmentseed/deck.gl-raster`. There were no breaking changes to the `COGLayer`.

### New Features

- New `MultiCOGLayer`:
    * feat: Initial work for `MultiCOGLayer`: cross-resolution tileset for sentinel/landsat by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/408
    * feat: Debug view for MultiCOGLayer by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/410
    * fix: Fix edge tile rendering in MultiCOGLayer by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/411
    * fix: Define `byteLength` on MultiCOG internal tile data by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/413
    * fix: Ensure we reset state when changing sources in MultiCOGLayer by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/414
    * fix: Filter out nodata pixels in Sentinel-2 example by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/415
* feat: Pass any `TextureSource` to `MeshTextureLayer` by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/369
* feat(geotiff): Support multi-tile fetching by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/406

### Fixes

* fix: Turn off lighting/`material` by default by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/423
* fix: Remove alignment workarounds, bump to deck/luma 9.3 by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/419
* fix: Move `lerc` to non-dev dependencies by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/367
* fix: Fix black flash when panning by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/377

### Performance

* perf: Avoid unnecessary mesh recomputation by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/370
* perf: Cache the result of bounding volume computation per RasterTileNode by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/371

### Other

* feat: Print tile xyz index in COG Layer debug mode by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/378
* ci: pin GitHub Actions to SHA digests (fix zizmor unpinned-uses) by @lhoupert in https://github.com/developmentseed/deck.gl-raster/pull/390
* refactor: move projection utils from `deck.gl-geotiff` to `proj` package by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/398
* fix: Use `MapboxOverlayProps` instead of `DeckProps` in example to fix type check by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/400
* chore: deduplicate tsconfigs in examples folder by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/426
* ci: Ensure we typecheck examples by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/427
* ci: Apply typechecking to source packages on CI by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/430
* ci: deploy docs only on release tags by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/433
* feat: Clean up sentinel-2 example by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/437
* docs: Add link from example cards to code source by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/439
* docs: Update screenshots in docs by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/440
* docs: Update examples to link back to docs website by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/441

### New Contributors

* @lhoupert made their first contribution in https://github.com/developmentseed/deck.gl-raster/pull/390

**Full Changelog**: https://github.com/developmentseed/deck.gl-raster/compare/v0.4.0...v0.5.0

## v0.4.0 - 2026-03-20

### What's Changed

* feat: expose maxRequests on COGLayer by @maxrjones in https://github.com/developmentseed/deck.gl-raster/pull/333
* fix: Bump proj4 to fix web mercator projection by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/346
* fix: fix setting default values for inherited props from TileLayer by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/347
* fix: Render mesh from Web Mercator coordinates by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/349
* fix: Clamp to Web Mercator latitude bounds by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/182
* feat: create new `@developmentseed/proj` subpackage by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/356
* fix: Support TileLayer refinement strategies by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/354
* feat: add ndvi filter slider to NAIP-mosaic example by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/357

### New Contributors

* @maxrjones made their first contribution in https://github.com/developmentseed/deck.gl-raster/pull/333
* @aboydnw made their first contribution in https://github.com/developmentseed/deck.gl-raster/pull/348

**Full Changelog**: https://github.com/developmentseed/deck.gl-raster/compare/v0.3.0...v0.4.0

## v0.3.0 - 2026-03-18

### What's Changed

* fix: Fix shader caching by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/221
* feat: Create new `geotiff` subpackage, abstracting over `@cogeotiff/core` by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/223
* feat(affine): Create new `affine` standalone package as port of Python `affine` by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/224
* feat: Initial GeoTIFF dynamic decoder API by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/226
* feat(geotiff): Overhaul `GeoTIFF` and `Overview` classes by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/225
* chore: Use `@chunkd/source-file` in tests for loading tiffs by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/227
* feat(geotiff): Support decoding JPEG and WebP-compressed COGs by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/229
* feat(geotiff): High-level CRS handling from GeoTIFF GeoKeys by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/236
* feat: Create `morecantile` subpackage by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/238
* feat(geotiff): generate TileMatrixSet from `GeoTIFF` instance by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/235
* feat: Overhaul to use our `geotiff` package & generic TileMatrixSet support by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/208
* feat: Add AbortSignal support to `GeoTIFF.fetchTile` by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/243
* chore: Update code for new upstream `SamplesPerPixel` typing by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/245
* test(geotiff): Add integration tests against geotiff.js by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/246
* feat(geotiff): LZW and Predictor support by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/247
* fix: Fix rendering of YCbCr-encoded JPEG images by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/249
* feat(geotiff): Support non-boundless reads by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/250
* feat(geotiff): Add tileCount property to GeoTIFF and Overview by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/254
* feat(geotiff): User-specified prefetch size by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/256
* fix: Fix declared luma.gl dependency by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/265
* fix: Fix `TileMatrixSetTileset` projected bounds computation for each tile by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/274
* feat: Add mesh max error slider to NLCD example by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/271
* feat: add zstd via fzstd by @gadomski in https://github.com/developmentseed/deck.gl-raster/pull/263
* feat: Offset transform by half pixel for pixel-is-point raster type by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/286
* feat: New `@developmentseed/epsg` package for shipping compressed EPSG code bundle by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/262
* fix: Ensure 4-byte alignment on texture buffers by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/289
* chore: Update import of TiffImageTileCount by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/291
* fix: Update naip-mosaic example to use our `geotiff` package by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/293
* fix: Turn off TIFF chunking for now by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/295
* feat: Decoder pool by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/277
* docs: Rewording of readme by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/296
* feat: Support reading band-interleaved COGs by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/297
* feat(geotiff): Separate source for header fetches and data fetches by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/299
* refactor: Cleaner type defs for DecodedPixels and RasterArray by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/306
* fix: Avoid unnecessarily calling `inferDefaultPipeline` by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/307
* fix: Force loading gdal tags (nodata and metadata) by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/308
* test(geotiff): Set up integration tests against rasterio by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/311
* feat: Handle GeoTIFF transparency masks by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/309
* feat: Support lerc+deflate and lerc+zstd by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/314
* feat: Parse GDAL_Metadata TIFF tag, including stored statistics and offsets/scales by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/316
* feat: Support grayscale photometric interpretation by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/179
* fix: Fix adding alpha channel to uint16 image by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/318
* feat: Update `cog-basic` example app with drop-down image selector by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/323
* fix: Fix passing general layer props down to RasterLayer by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/329
* docs: Initial creation of docusaurus-based documentation website by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/304
* ci: Fix docs publish; fetch submodules by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/331
* docs: Initialize blog on website by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/332
* docs: API docs review by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/335
* ci: Fix building examples as part of docs website generation by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/336
* docs: Add example nav pane in top bar by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/337
* docs: Switch to DS logos and add simple static search index by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/338
* docs: Update hero image with USGS unsplash photo by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/339
* docs: Use smaller hero image for slightly smaller download size by @kylebarron in https://github.com/developmentseed/deck.gl-raster/pull/340

**Full Changelog**: https://github.com/developmentseed/deck.gl-raster/compare/v0.2.0...v0.3.0

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
