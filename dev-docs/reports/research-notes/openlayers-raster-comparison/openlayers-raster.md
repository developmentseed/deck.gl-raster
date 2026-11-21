# OpenLayers raster rendering: features and user-facing API

**Question.** What raster features and user-facing API does OpenLayers offer (GeoTIFF / GeoZarr / DataTile sources, the WebGL tile renderer, styling and expressions, pixel data access, the CPU Raster source, the other raster paths, examples, and limitations), as input to a comparison with deck.gl-raster? Reprojection internals (`src/ol/reproj*`, source-resolution choice) are out of scope here; only the user-facing reprojection knobs are covered.

**Provenance.** A local clone of [openlayers/openlayers](https://github.com/openlayers/openlayers) at `e50554ba` (2026-11-02), `package.json:3` version `10.11.1-dev`. License BSD-2-Clause (`LICENSE.md:1`). Dependencies: `geotiff ^3.1.0-beta.0` (`package.json:49`), `zarrita ^0.7.1` (`package.json:52`), `proj4 2.20.9` dev (`package.json:120`). `node_modules` is not installed in the OL clone, so for two dependency questions I read MIT-licensed clones of geotiff.js (`1d4e7bc`, 2026-03-30) and zarrita.js (`c5d7a7d`, package v0.7.3). Those versions may differ slightly from what OL resolves. Nothing was run; every claim is from reading code. Items marked *(inference)* are my reading, not stated in the code.

All paths below are relative to the OL repo root unless noted.

---

## 0. Headline facts

- **WebGL 1 only.** Context IDs are `['experimental-webgl', 'webgl', 'webkit-3d', 'moz-webgl']` (`src/ol/webgl.js:87`); there is no `webgl2`, `#version 300 es`, `texelFetch` or integer texture anywhere in `src/ol` (grep). Shaders are GLSL ES 1.00 (`texture2D`, `gl_FragColor`, `varying`; `src/ol/layer/WebGLTile.js:98-117, 245-288`).
- **Only two GPU data types: uint8 (normalized) and float32.** `uploadDataTexture` uses `gl.FLOAT` for `Float32Array`, else `gl.UNSIGNED_BYTE`, with unsized `LUMINANCE` / `LUMINANCE_ALPHA` / `RGB` / `RGBA` formats (`src/ol/webgl/TileTexture.js:57-101`). `DataTile` accepts only `Uint8Array | Uint8ClampedArray | Float32Array | DataView` or image-likes (`src/ol/DataTile.js:9-19, 25-45`). uint16/int16/int32 must be converted on the CPU: GeoTIFF converts to Uint8 (default `normalize: true`, quantized via min/max) or Float32 (`normalize: false`) (`src/ol/source/GeoTIFF.js:1109-1115`); GeoZarr always emits Float32 (`src/ol/source/GeoZarr.js:1930`).
- **>4 bands** are de-interleaved on the CPU into `ceil(n/4)` textures (`TileTexture.js:260-322`) and read in the shader through a generated `if (band == k)` chain (`src/ol/expr/gpu.js:379-408`).
- **Each tile is one textured quad** in view space, drawn with a 2D affine (scale/rotate/translate) tile transform (`src/ol/renderer/webgl/TileLayerBase.js:569-581`). A reprojected tile is a new data tile in the view CRS (`ReprojDataTile extends DataTile`, `src/ol/reproj/DataTile.js:75`) that is uploaded and drawn like any other quad, so there is no per-frame GPU reprojection mesh in the tile renderer (details belong to the reprojection notes). View has rotation, no pitch/3D/globe.
- **Styling is a JSON expression language compiled to GLSL** (`band`, `interpolate`, `case`, `match`, `palette`, math, comparisons, `var`), plus fixed brightness/contrast/exposure/saturation/gamma stages (`WebGLTile.js:24-43, 129-174`). `updateStyleVariables` only updates uniforms; `setStyle` recompiles (`WebGLTile.js:634-652`).
- **Decode/compose is mostly main thread.** GeoTIFF decodes in a geotiff.js worker `Pool` but normalizes/composes bands + nodata alpha on the main thread (`GeoTIFF.js:125-131, 1096-1270`). GeoZarr has no workers: zarrita decodes on the calling thread and `composeData` runs on the main thread (`GeoZarr.js:1914-2004`; zarrita core has no `new Worker`, grep of `packages/zarrita/src`).
- **GeoZarr is experimental** (`changelog/v10.8.0.md:3`) and has no `@api` tag (0 occurrences in `src/ol/source/GeoZarr.js`), so it is outside the documented/stable API (`config/jsdoc/api/readme.md:25`).

---

## 1. Sources

### 1.1 `ol/source/GeoTIFF` (`src/ol/source/GeoTIFF.js`, extends `DataTileSource`, `:472`)

**Per-source options (`SourceInfo`, `:71-98`)**

| Option | Behaviour | Ref |
|---|---|---|
| `url` | HTTP(S) COG/GeoTIFF | `:73`, opened with `fromUrl` `:305` |
| `loader(url, headers, signal) => Promise<Response>` | custom fetch (auth, signing, retry); wrapped as a geotiff.js custom client | `:74-75, 254-276, 287-297` |
| `overviews: string[]` | external overview files (e.g. `.ovr`), opened with `fromUrls` (MultiGeoTIFF); **not allowed together with `loader`** (throws) | `:76, 288-303` |
| `blob` | Blob/File source (`fromBlob`); mutually exclusive with `url` | `:77, 285-286` |
| `min`, `max` (number or per-band array, indexed by *file* band) | normalization range; defaults to GDAL `STATISTICS_MINIMUM/MAXIMUM`, else the data-type range | `:78-89, 1137-1170` |
| `nodata` (number or per-band array) | overrides metadata nodata; adds an alpha band | `:90-94, 861-869, 1007-1031` |
| `bands: number[]` (1-based) | subset of bands to read (`samples`) | `:95-97, 999-1003` |

**Source-level options (`Options`, `:433-462`)**

| Option | Default | Notes | Ref |
|---|---|---|---|
| `sources: SourceInfo[]` | required | several files stacked as bands (see below) | `:436-443` |
| `sourceOptions` | - | passed to geotiff.js `fromUrl`/`fromUrls`/`fromCustomClient`: `forceXHR`, `headers`, `credentials`, `maxRanges`, `allowFullFile`, `blockSize` (65536), `cacheSize` (100 blocks LRU) | `:419-431, 444, 568-575` |
| `convertToRGB` | `false` | `true` always uses `image.readRGB()`; `'auto'` converts 3-sample CMYK/YCbCr/CIELab/ICCLab | `:44-69, 445-448, 1054-1056` |
| `normalize` | `true` | `true` -> Uint8 0..255 from min/max; `false` -> raw Float32, `min`/`max` ignored | `:449-452, 1109-1115` |
| `projection` | from GeoKeys | skips detection | `:453-454, 481-483, 849-851` |
| `loadMissingProjection` | `false` | fetch unknown EPSG defs via `fromProjectionCode` | `:455-456, 196-198` |
| `transition` | 250 ms | tile fade-in | `:457-458` |
| `wrapX` | `false` | | `:459` |
| `interpolate` | `true` | GPU linear vs nearest | `:460-461, 485` |
| `attributions` | - | | `:435` |

**Opening, overviews, strips**
- All IFDs are read (`getImagesForTIFF`, `:244-252`). Masks (`NewSubfileType & 4`) are split from images (`:39-42, 693-699`); if any mask exists there must be exactly one per image (`:701-706`). Images and masks are sorted by width descending (`:708-709`; "automatically sort images in multi-page geotiffs", `changelog/v10.10.0.md:87`).
- The OL tile grid is the COG's own internal tiling: one `TileGrid` level per IFD, tile size = internal tile size, with non-square pixels handled by a render tile size of `[w, h / aspectRatio]` (`:743-760, 906-919`). One OL tile = one internal COG tile per source.
- Strip (untiled) TIFFs over HTTP: tile size forced to 256x256 and the file is re-opened with `blockSize = width * bytesPerPixel * 256` so one render tile becomes about one range request (`:308-335, 745-752`; changelog `v10.9.0.md:32`).
- Rotated/sheared affine (`ModelTransformation` tag): `determineTransformMatrix` builds `transformMatrix` and sets `hasAlpha = true` (`:633-662`); any non-null `transformMatrix` forces the reprojection path even in the native CRS (`src/ol/source/DataTile.js:324-328, 233-243`). Example `cog-modeltransformation`.

**Projection detection (`:186-238, 612-625`)**
- `determineProjection` walks images from the smallest overview up, reading `ProjectedCSTypeGeoKey` (units `ProjLinearUnitsGeoKey`), then `GeographicTypeGeoKey` (units `GeogAngularUnitsGeoKey`) (`:218-238, 612-625`).
- Code `32767` (user-defined) or missing -> `null` (`:193`). There is no parsing of user-defined GeoKey parameters (projection method, datum, etc.).
- Known/registered code -> cached projection (`:195`). EPSG:3857/4326 are built in; UTM WGS84 `EPSG:326xx/327xx` are built in through projection/transform factories (`src/ol/proj.js:100-105`, `src/ol/proj/utm.js:210-235`), so Sentinel-2 UTM COGs need no proj4.
- Unknown code + `loadMissingProjection: true` -> `fromProjectionCode(code)`, which requires `register(proj4)` and by default fetches WKT from `https://spatialreference.org/ref/{authority}/{num}/ogcwkt/` (`src/ol/proj/proj4.js:98-112, 151-176`); the lookup is replaceable with `setProjectionCodeLookup` (`proj4.js:123-125`).
- Unknown code without loading -> a bare `new Projection({code, units})` if the unit code is one of 9001/9002/9003/9101/9102 (`GeoTIFF.js:199-206`, `src/ol/proj/Units.js:14-28`). It has no transforms, so it can only be shown in its own view; reprojecting needs a transform that does not exist (`src/ol/proj.js:508-541` returns `null`) *(inference about the visible failure mode)*.
- No projection at all (`null`): `getView()` resolves with `projection: null`, the `View` then defaults to EPSG:3857 (`src/ol/View.js:362`, `src/ol/proj.js:354-357`), and `DataTileSource.getTile` does not reproject a source with no projection (`DataTile.js:324-328`). The raster is drawn at its native coordinates as if they were view coordinates *(inference)*.
- Escape hatches: pass `projection` (e.g. a proj4-registered code), or subclass and override `determineProjection` ("override this method in a subclass to support more projections", `:603-611`).

**Several files stacked as bands (`sources: [...]`)**
- Each file contributes its samples (all, or `bands`) in order; the band count is the sum plus one alpha band if needed (`:899-904`).
- Constraints checked in `configure_`: identical origin (tolerance 0, `:773-784`); resolution sets equal after a per-source scale factor (2% tolerance, `:786-808`), so e.g. 10 m + 60 m Sentinel-2 files combine (example `cog-math-multisource`); equal render tile sizes (1%) and source tile sizes (exact) (`:810-832`); extent = intersection (`:763-771`). A source with fewer levels raises `minZoom` (`:790-792, 838-847`).
- Coarser sources are read with a scaled window and resampled to the tile size by geotiff.js `readRasters({window, width, height})` (`:989-994, 1044-1053`); OL passes no `resampleMethod`, and geotiff.js defaults to `'nearest'` (geotiff.js `src/resample.js:107`).
- The code writes a single alpha band last, after all sources (`:899-904, 1261-1266`); `multiple-cogs.js:57` uses `['band', 5]` for 4 single-band files.

**Normalization, nodata, masks -> alpha (`composeTile_`, `:1096-1270`, main thread)**
- `normalize: true`: per-sample `gain = 255/(max-min)`, `bias = -min*gain`, clamp 0..255 into a `Uint8Array` (`:1111-1112, 1169-1170, 1217-1223`). This quantizes 16-bit data to 8 bits before the GPU. Defaults: `STATISTICS_MINIMUM/MAXIMUM` from `getGDALMetadata(0)` of the full-res image (`:723, 1128, 1144-1166`), else the data-type range (`:371-417`).
  - Float32 without stats defaults to `min = 1.2e-38`, `max = 3.4e38` (`:381-383, 413-415`), which maps real data to ~0; float data needs explicit `min`/`max` or `normalize: false` *(inference about the visible result)*.
- `normalize: false`: raw values copied into a `Float32Array` (`:1113-1114, 1225`). uint8 inputs also become float32 (4x memory) *(inference)*.
- Alpha band (`hasAlpha`) is added when any source has a configured `nodata`, any mask IFD, or GDAL nodata metadata (`:858-897`). A pixel is transparent only when **all** samples of all sources equal nodata (NaN-aware, `:1231-1239`), or when a mask reads 0 (`:1243-1259`); opaque pixels get alpha 255 (`:1261-1266`). The shader discards when the alpha band is 0 (`WebGLTile.js:281`).
- Nodata from metadata comes from `image.getGDALNoData()`, one value per IFD (`:722-724`).
- `fillValue` (nodata) is passed to geotiff.js for out-of-bounds reads (`:1005-1049`).

**Worker pool and geotiff.js features used**
- One module-level `new Pool()` shared by every GeoTIFF source (`:125-131`), passed as `pool` to `readRasters`/`readRGB` and mask reads (`:1044-1075`). geotiff.js `Pool` default size = `navigator.hardwareConcurrency || 2` (geotiff.js `src/pool.js:4, 122`). Decompression happens in the pool; composing is on the main thread (`:1078-1087, 1096-1270`).
- Abort: the tile's `AbortController.signal` is passed to `readRasters` (`:1052`), and the tile aborts on dispose (`src/ol/DataTile.js:209-215`). Queued tiles that are no longer wanted are dropped by the TileQueue (`src/ol/TileQueue.js:150-154`).
- geotiff.js API surface used: `fromUrl`, `fromUrls`, `fromBlob`, `fromCustomClient`, `Pool`, `globals.photometricInterpretations` (`:4-11, 62`); `getImageCount`/`getImage` (`:245-249`); `fileDirectory.getValue('NewSubfileType' | 'PhotometricInterpretation' | 'ModelTransformation')` (`:40, 59, 637`); `getGeoKeys` (`:219`); `getBoundingBox(true)`, `getOrigin`, `getResolution(ref)` with pixel-space fallbacks for non-georeferenced files (`:139-177`); `getTileWidth/Height`, `getWidth/Height`, `getBytesPerPixel`, `getSamplesPerPixel` (`:316-320, 727-729, 743`); `getGDALNoData`, `getGDALMetadata(0)` (`:722-723`); `readRasters({window, width, height, samples, fillValue, pool, interleave: false, signal})` and `readRGB` (`:1044-1058`).

**`getView()`** (doc `:1273-1294`; promise created in `src/ol/source/Source.js:111-126, 167`): resolves with `{showFullExtent: true, projection, resolutions, center, extent, zoom: 1}`; resolutions are the tile-grid levels, padded to 3 when the file has only 1 or 2 levels; with a `transformMatrix` the extent is the transformed bbox (`:924-968`). The `Map` accepts the promise directly as `view` (`src/ol/Map.js:183`). Helpers `getView(source, withHigherResolutions(n), withLowerResolutions(n), withExtentCenter(), withZoom(z))` post-process it (`src/ol/View.js:2282-2364`).

**Errors**: `getError()` returns the configure error after state `'error'` (`:587-601`).

### 1.2 `ol/source/GeoZarr` (`src/ol/source/GeoZarr.js`, extends `DataTileSource`, `:115`)

**Status**: "experimental" (`changelog/v10.8.0.md:3`); no `@api` tags in the file.

**Options (`:42-87`)**: `url` (multiscales group, or base URL in multi-group mode), `bands: Array<string | {name, group}>`, `variable` (one n-D array holding all bands; mutually exclusive with `bands`), `dimensions: {name: index | label | [indices]}`, `storeOptions: {headers, credentials}` (passed as zarrita `FetchStore` `overrides`, `:36-40, 378-382`), `projection`, `transition` (250), `wrapX` (false), `resample: 'nearest' | 'linear'` (default `'linear'`, `:65, 321`), fallback `extent`, fallback `flipY`. **No** `interpolate`, `attributions`, `normalize`/`min`/`max`, or custom fetch/loader option. With `interpolate` unset, the source passes `undefined` and tiles sample with GPU NEAREST (`src/ol/source/Source.js:105`, `src/ol/Tile.js:125`) *(inference from defaults)*.

**Store access and metadata**
- zarrita: `FetchStore` wrapped in `withRangeCoalescing` (`:5-12, 379-383`); version detected by probing `/zarr.json` (v3) then `/.zmetadata` (v2) (`:387-414`); Zarr v2 and v3 supported (`:113`).
- Consolidated metadata (v3 `consolidated_metadata`, v2 `.zmetadata`) is served from memory to avoid per-array requests (`:416-426, 1666-1688, 2077-2095, 2145-2166`); without it, per-array `zarr.json` / `.zarray`+`.zattrs` are fetched (`:2201-2224`).
- A 403 is mapped to 404 so S3 "missing key" works (`:2187-2191`).
- Opened arrays cached as promises (`:221-227, 801-817`); a 32-entry LRU of chunk-fetch promises (`withChunkCache`, `:2027-2068`); byte-range reads go through `getRange` and bypass that cache (`:2066`).

**Multiscales and tile grid (`configureLevels_`, `:1133-1526`)**
- Levels from `multiscales` in either `[{datasets: [{path}]}]` or `{layout: [{asset}]}` form, or the group itself as a single level (`:1146-1191`); legacy `multiscales.tile_matrix_set` + `tile_matrix_limits` (OGC TMS) also supported (`:458-495, 1857-1900`).
- Extent from `spatial:bbox` / `bounds`, else from the first/last values of 1-D coordinate arrays (pixel-centre, padded by half a pixel; 0..360 longitudes normalized) (`:1248-1319`); orientation from `spatial:transform[4]` sign or coordinate order; south-up rows are flipped after read (`:1253-1322, 2231-2245`); descending x is unsupported (warn, `:1290-1292`). Non-square pixels are tracked as a separate row resolution (`:1326-1363`).
- Tile grid is a `WMTSTileGrid` with per-level origin/resolution/matrixId (`:1516-1524`). Tile sizes are aligned to shards (`sharding_indexed` inner chunks, tiles 64..512 px) or to large unsharded chunks (up to 2048 px) (`:1460-1494, 1725-1851, 2097-2121`).
- Bands missing at a level are read from the nearest coarser level that has them and resampled on the CPU (`'nearest'` or bilinear `'linear'`) to the tile grid (`:585-607, 1914-1987`; example `geozarr-sparse`).

**CRS (`inferProjection_`, `:1538-1587`; `getProjectionFromAttributes`, `:2010-2021`)**
- Order: `proj:code` (only if already registered, via `get(code)`), else `proj:projjson` / `proj:wkt2` (needs `register(proj4)`; `fromProjectionDefinition`, `src/ol/proj/proj4.js:179-209`), then a `crs` string in multiscales datasets, xarray-style `spatial_ref` containing `':'`, a `proj4`/`proj4_params` attribute, then **EPSG:4326 if the extent looks like degrees**; else throws "Could not determine the projection".
- No automatic fetch of unknown codes (only `fromProjectionDefinition` is imported, `:16`).

**Extra dimensions / time (`:66-80, 897-1121, 1373-1454`)**
- `dimensions: {time: 0}` picks a slice (index or coordinate label; labels resolved once against the coordinate array, `:510-523, 1618-1636`); unlisted dims default to index 0 (`:1096-1100`, warn in `variable` mode `:1388-1391`).
- With `variable`, one dimension may list several values, each rendered as a band in order (e.g. `{band: [0, 1, 2], time: 1}`) (`:328-349, 1373-1454`; example `geozarr-datacube.js:43-49`).
- `getDimensions()` -> `{name: {size, attributes}}` (`:897-909`); `getValue(name, index)` -> raw coordinate value (`:922-939`); `updateDimensions({time: 3})` changes the slice without rebuilding the source by changing the source key, which keeps earlier slices' tiles cached and shows them as stale tiles meanwhile (`:951-1004`; renderer stale keys below).

**Chunk loading (`loadTile_`, `:570-714`)**
- Per tile, per band: compute the row/col window at the band's level, open arrays in parallel, then `zarrita.get(array, [rowSlice, colSlice])` (with fixed indices on extra axes) for all bands in the same tick so range requests coalesce (`:672-699`).
- **The tile `AbortSignal` is ignored**: `options` is unused and no `signal` appears anywhere in the file (grep), so in-flight GeoZarr loads cannot be cancelled.
- Output: `Float32Array`, pixel-interleaved, plus a 0/1 alpha band when the array has a `fill_value` (`:501-505, 1456-1458, 1914-2004`); NaN values are written as 0 (`:1991-1993`). One fill value for all bands (from the first array, `:1456-1458`; or the first extra-group band, `:749-751`). No CF `scale_factor`/`add_offset` handling in OL (grep).

**Codecs**: OL registers none; it relies on zarrita's default registry. In the local zarrita clone (v0.7.3) that is `blosc`, `lz4`, `zstd` (lazy `numcodecs` wasm), `gzip`, `zlib`, `transpose`, `bytes`, `crc32c`, `vlen-utf8`, `json2`, `bitround`, `cast_value`, `scale_offset`, plus `numcodecs.*` aliases incl. `shuffle` and `delta` (zarrita `packages/zarrita/src/codecs.ts:46-77`); sharding via `sharding_indexed` (`packages/zarrita/src/util.ts:400-411`).

**`getView()`**: resolved from the tile grid (resolutions, extent, projection, `zoom: 1`) in a `setTimeout` after configure (`:544-559`).

### 1.3 `ol/source/DataTile` (`src/ol/source/DataTile.js`) and custom loaders

**Loader API**: `loader(z, x, y, {signal, crossOrigin, referrerPolicy, maxY}) => Data | Promise<Data>` (`:28-41`). `maxY` is set from the grid's full tile range (`:368-374`). The source creates an `AbortController` per tile (`:346-355`) and aborts on tile dispose (`src/ol/DataTile.js:209-215`).

**Accepted data** (`src/ol/DataTile.js:9-19, 25-45`): `Uint8Array`, `Uint8ClampedArray`, `Float32Array`, `DataView`, or image-like (`HTMLImageElement`, `HTMLCanvasElement`, `HTMLVideoElement`, `ImageBitmap`). Arrays are **pixel-interleaved** (`[p0b0, p0b1, ..., p1b0, ...]`, de-interleaved per `TileTexture.js:289-306`). The band count used for upload is derived from `byteLength / rows / bytesPerElement / width` (`TileTexture.js:257-259`), while the shader is built from `source.bandCount` (`WebGLTile.js:462-471`), so they must agree *(inference)*. `DataView` is treated as bytes (UNSIGNED_BYTE) and the >4-band de-interleave indexes it like an array (`TileTexture.js:252-259, 292-295`), so in practice use typed arrays *(inference)*.

**Options (`:43-76`)**: `loader`, `projection` (default `'EPSG:3857'`, `:92-93`), `tileGrid` (default `createXYZ` over the projection extent, `:95-104`), `tileSize` (256), `minZoom`/`maxZoom` (0/42), `maxResolution`, `bandCount` (default 4, `:157`), `hasAlpha` (default true for 2 or 4 bands, `:165-168`), `gutter` (extra pixels around each tile, for neighbour sampling; ignored when reprojecting, `:233-243`), `interpolate` (default **false**), `transition`, `wrapX` (false), `crossOrigin`, `referrerPolicy`, `key`, `zDirection`, `attributions`, `state`.
- The source itself does not cache tiles (`cacheSize: 0.1`, `:107`); caching is in the layer renderer.
- `setTileGridForProjection(projection, grid)` (`:489-509`) sets the target grid used when reprojecting; by default the target grid's max zoom is capped from the source's finest resolution (`:457-480`).
- `setLoader` is protected (`:245-251`); `transformMatrix` (public field, `:194-197`) forces reprojection (`:324-328`).

**How users write loaders (examples)**
- `data-tiles.js:22-37`: returns canvas `ImageData.data` (Uint8ClampedArray RGBA).
- `numpytile.js:13-37, 67-70`: fetches 16-bit `.npy` tiles from TiTiler, converts to a 5-band **Float32Array** (OL has no uint16 path), `bandCount: 5`.
- `pmtiles-elevation.js:23-29`: returns an `HTMLImageElement`, uses `{signal}`.
- `contour-interpolation.js:33-89`: 3x3 neighbour stitching with `gutter: 1`, float32 elevation, `interpolate: true`; warns when `OES_texture_float_linear` is missing (`:240-244`).
- `wind.js:65-110`: Float32 u/v field resampled per tile in JS for the `Flow` layer; `transition: 0` required (`:66`).

---

## 2. Rendering (`ol/layer/WebGLTile`, `ol/renderer/webgl/TileLayer[Base]`, `ol/webgl/TileTexture`)

**Layer options** (`src/ol/layer/WebGLTile.js:45-81`): `style`, `source`, `sources` (array or `(extent, resolution) => sources`), `preload` (0), `cacheSize` (512), `opacity`, `visible`, `extent`, `zIndex`, `min/maxResolution`, `min/maxZoom`, `className`, `useInterimTilesOnError` (deprecated), `properties`, `map`.

**Per-tile geometry and transform**
- Index buffer `[0,1,3, 1,2,3]` and a unit-square `a_textureCoord` per tile (`TileLayer.js:104-105`, `TileTexture.js:162-178`); vertex shader `gl_Position = u_tileTransform * vec4(a_textureCoord, u_depth, 1)` (`WebGLTile.js:98-117`).
- Tile transform = scale to clip space, `rotate(viewState.rotation)`, aspect correction, translate (`TileLayerBase.js:569-581`); rotated views cull tiles against the rotated viewport (`:353-377`). No perspective term.
- Fragment shader discards outside `u_renderExtent` = view extent intersected with the layer `extent` and, if not `wrapX`, the source grid extent (`WebGLTile.js:266-273`, `TileLayerBase.js:115-139`).
- Premultiplied output times the transition alpha (`WebGLTile.js:285-287`); blending `ONE, ONE_MINUS_SRC_ALPHA` (or `ZERO` when no tile is mid-fade), depth test `LEQUAL` (`src/ol/webgl/Helper.js:596-603`, `TileLayerBase.js:464-467`).

**Texture formats per data type** (`TileTexture.js:19-117`)

| Input | GL type | Format by bands-per-texture | Filtering | Shader value |
|---|---|---|---|---|
| image-like | `UNSIGNED_BYTE` | `RGBA` | `interpolate ? LINEAR : NEAREST` | 0..1 |
| `Uint8Array`/`Uint8ClampedArray` | `UNSIGNED_BYTE` | 1 `LUMINANCE`, 2 `LUMINANCE_ALPHA`, 3 `RGB`, 4 `RGBA` | as above | 0..1 (normalized by GL) |
| `Float32Array` | `FLOAT` (requests `OES_texture_float`) | same unsized formats | LINEAR only if `OES_texture_float_linear`, else NEAREST | raw |
| uint16 / int16 / int32 | not supported; convert on CPU | | | |

- Unpack alignment chosen from row bytes (`:70-78, 103-116`); `CLAMP_TO_EDGE` (`:22-23`); no mipmaps.
- No fallback if `OES_texture_float` is missing (`:61`) *(inference: float tiles then fail to upload)*.

**More than 4 bands** (`TileTexture.js:260-322`): `ceil(n/4)` textures; all RGBA except the last with `((n-1) % 4) + 1` channels; CPU de-interleave loop per tile. Shader declares `uniform sampler2D u_tileTextures[ceil(n/4)]` (`WebGLTile.js:206-210`) and `getBandValue(band, dx, dy)` is an `if (band == k.0)` chain over all bands, mapping band k to texture `floor(k/4)`, channel `k%4`, with the `LUMINANCE_ALPHA` fix (2nd channel read from `.a`) (`gpu.js:379-408`). Each tile binds all its textures plus all palette textures to consecutive units (`TileLayer.js:236-256`); there is no check against `MAX_TEXTURE_IMAGE_UNITS` (grep), so the practical cap is about `4 x (units - palettes)` bands (16 units -> ~64 bands) *(inference)*.

**Normalization summary**: uint8/image data reaches the shader as 0..1 (expression docs: "Fetched values are in the 0..1 range", `src/ol/expr/expression.js:22-28`); float data is raw. GeoTIFF defaults to `normalize: true` (8-bit); GeoZarr is always raw float32. Examples decode Terrarium/Terrain-RGB by multiplying by 255 because "band math operates on normalized values from 0-1" (`webgl-shaded-relief.js:21`, `webgl-sea-level.js:12`).

**Drawing while loading / other z levels** (`TileLayerBase.js:604-826`)
- Only the target z is enqueued normally (`:648`; `minZ = max(initialZ - preload, ...)`, `:338-352`).
- For each target tile that is not ready or still fading: (1) a ready tile at the same coord from a previous source key ("stale tile", shown opaque until the new tile has faded in), (2) children at z+1 only if they fully cover it, (3) ancestors from z-1 down to `minZoom` (`:676-744`).
- All found tiles are drawn highest z first with depth `1/(z+2)` so finer tiles win the depth test; fading tiles get depth -1 and are drawn last (`:43-45, 546-550, 746-810`). `frameState.animate = true` while fading (`:548-550`).

**Tile cache and eviction**
- Per-layer LRU of `TileTexture` (GPU textures) of `cacheSize` (default 512; "needs to be large enough to render two zoom levels worth of tiles") (`WebGLTile.js:78-79`, `TileLayerBase.js:234-241`); `expireCache()` every frame (`:821-822`); evicted entries are disposed (`src/ol/structs/LRUCache.js:62-66`), which deletes their textures via `setHelper(null)` (`TileTexture.js:187-201`, `src/ol/webgl/BaseTileRepresentation.js:120-123`). Disposing the representation does not dispose the source tile (`BaseTileRepresentation.js:120-123`) *(reading-based)*.
- Whole cache cleared on view-projection change (`TileLayerBase.js:279-284`) and on `setSource` (`WebGLTile.js:411-414`).
- When reprojecting, a second LRU(512) of source tiles is used (`TileLayerBase.js:396-401, 929-934`).
- Map-wide concurrency: `maxTilesLoading` default 16 (`src/ol/Map.js:165-166, 325-326`).
- A source shared by two layers is uploaded twice (cache is per renderer) *(inference)*; `contour-interpolation.js:99` notes "duplicate layers as one layer shared by two raster sources causes rendering issues".

**Preload** (`BaseTile.js:37-38, 102`; `TileLayerBase.js:632-663`): `preload: n` enqueues z-1..z-n in a deferred `setTimeout`; during animations, tiles for `nextExtent`/`nextResolution` are enqueued too (`:633-646`).

**Transitions and source-key changes**
- Fade-in duration from the source `transition` (default 250 ms; `DataTile.js:62`, `GeoTIFF.js:457-458`); per-tile alpha from `tile.getAlpha(uid, time)` (`TileLayerBase.js:689`).
- Changing a source key (`ImageTile#setUrl`, `GeoZarr#updateDimensions`, WMS `TIME` param) keeps up to `cacheSize * 0.5` previous keys as "stale keys" whose tiles are shown until new ones are ready (`TileLayerBase.js:241, 625, 843-869`; `src/ol/renderer/Layer.js:9, 46, 58-84`; changelog `v10.10.0.md:65`). Examples `wms-time-webgl`, `reusable-source`, `geozarr-dimensions`.

**Multiple sources** (`WebGLTile.js:68-72, 375-389, 543-624`)
- `sources` is constructor-only (no `setSources`; `:327-330`). It can be an array or a function `(extent, resolution) => sources`; `sourcesFromTileGrid(tileGrid, factory)` builds a per-tile-grid-cell function with an LRU(32) of sources (`src/ol/source.js:46-79`; example `cog-pyramid`).
- "All sources must have the same band count and content" (`:72`); the shader is built from the first source (`:435-439, 462-471`).
- Each source is rendered in turn into the same canvas (`:543-556`). While the current set is not complete, the layer also renders the sources that were wanted at the last fully rendered resolution, unless the view has zoomed out 2x or more since then (`renderedResolution_ > 0.5 * resolution`, `:606-623`).
- `getData(pixel)` uses the last ready source that covers the coordinate (`TileLayer.js:354-375`).

**Canvas grouping**: consecutive WebGL layers with the same `className` share one WebGL canvas/context; a non-WebGL layer or a different `className` starts a new group (`src/ol/renderer/webgl/Layer.js:146-192`).

**Shader rebuilds**: shaders are rebuilt on `setStyle`, on source change once it is ready (`WebGLTile.js:411-429, 634-642`), and when reprojection adds a coverage alpha band to an alpha-less source (`:441-504, 576-588`; changelog `v10.10.0.md:73`).

**Other files asked about**
- `src/ol/webgl/TileGeometry.js` is for **WebGL vector tiles** (`VectorRenderTile`, `:14-16`), used only by `renderer/webgl/VectorTileLayer.js`; not part of the raster path.
- `src/ol/webgl/PaletteTexture.js`: `N x 1` RGBA8 texture, NEAREST, `CLAMP_TO_EDGE`, built from the literal colours of a `palette` expression (`:25-46`; `gpu.js:409-432`).

---

## 3. Styling (`style` option and the expression language)

**Style object** (`WebGLTile.js:24-43`): `color` (expression, ColorType), `brightness` (0; -1..1), `contrast` (0; -1..1), `exposure` (0; -1..1), `saturation` (0; -1..1), `gamma` (1; 0..inf), `variables: {name: number | string}`.
- Fixed pipeline order: `color` -> contrast -> exposure -> saturation (luminance-weighted matrix) -> gamma (`pow(rgb, 1/gamma)`) -> brightness (`:129-174`).
- With no `color`, the first texture is used as RGBA, with alpha taken from the nodata band if any (`:275-279`). Any nodata band triggers `discard` when it is 0 (`:281`).
- Strings in variables become numbers via a global string->float map (`:193-199`, `gpu.js:82-107`). Variables are `uniform float` only (`:202-204`), so a colour has to be passed as separate r/g/b variables (`cog-colors.js:39-58`).

**Compilation**: `expressionToGlsl` -> `buildExpression` -> `parse` (type checking, `expression.js:305-396`) -> `compile` (`gpu.js:186-203, 448-495`) inside `parseStyle` (`WebGLTile.js:97-296`).

**GPU operators usable in raster styles** (compilers in `src/ol/expr/gpu.js:223-440`; semantics in `expression.js:15-140`)

| Group | Operators | Ref |
|---|---|---|
| read | `['band', n, dx?, dy?]` (n may itself be an expression, e.g. `['var', 'red']`; `dx`/`dy` are pixel offsets within the tile texture), `['var', name]`, `['resolution']`, `['zoom']` | `gpu.js:242-257, 379-408` |
| math | `+ - * /`, `%` (`mod`), `^` (`pow`), `abs`, `floor`, `ceil`, `round` (`floor(x+0.5)`), `sin`, `cos`, `atan` (1 or 2 args), `sqrt`, `clamp` | `gpu.js:280-306` |
| compare/logic | `== != > >= < <=`, `!`, `all`, `any`, `between`, `in` (literal haystack) | `gpu.js:259-279, 318-320, 348-359` |
| control | `case`, `match` (nested ternaries) | `gpu.js:307-317, 338-347` |
| ramps | `['interpolate', ['linear'] or ['exponential', base], input, stop1, out1, ...]`, number or colour outputs, `mix` with the ratio clamped to 0..1; stops may be `['var', ...]` | `gpu.js:321-337`, `expression.js:70-77, 966-1024` |
| colour | `['color', r, g, b, a?]` (rgb 0..255, divided by 255), `['array', ...]` (2-4 numbers -> `vecN`, used as-is, so 0..1 for colour), literal `[r,g,b(,a)]` or CSS strings, `['palette', indexExpr, [colours...]]` (literal colours only -> palette texture) | `gpu.js:360-378, 409-432`, `expression.js:1110-1141` |

- Not compiled for WebGL: `number`, `string`, `coalesce`, `concat`, `to-string` (listed as TODO, `gpu.js:433-439`) and `interpolate-hcl` ("Canvas only", `expression.js:78-80`; no GPU compiler, so `compile` throws "No compiler defined", `gpu.js:451-458`). Vector-only operators (`get`, `id`, `geometry-type`, `line-metric`, `has`) compile to attributes that the tile shader does not have *(inference)*.
- Neighbourhood ops (hillshade, slope) use `['band', n, dx, dy]`; neighbours across tile edges come from `CLAMP_TO_EDGE` unless the source has a `gutter` (`TileTexture.js:22-23`, `DataTile.js:54-56`) *(inference about edge seams)*. Examples `webgl-shaded-relief.js:16-41`, `pmtiles-elevation.js:31-62`.

**NDVI band math**: `['/', ['-', ['band', 2], ['band', 1]], ['+', ['band', 2], ['band', 1]]]` with band 1 = red file, band 2 = NIR file (`cog-math.js:5-26`, `cog-colors.js:62-66`). With `normalize: true` both bands are 0..1 after a shared 0..max scaling, so the ratio is preserved up to 8-bit quantization *(inference)*. With `normalize: false`, bands are raw and the user scales with `['/', ['band', i], max]` (`cog-style.js:6-14`).

**Variables vs recompiling**
- `updateStyleVariables(vars)` = `Object.assign(this.styleVariables_, vars); this.changed()` (`WebGLTile.js:649-652`). Uniforms are closures over that same object (`:186-200`) and function-valued uniforms are re-evaluated whenever the program is used (`src/ol/webgl/Helper.js:838-847, 934-942`). So it **re-renders without recompiling**.
- `setStyle(style)` replaces style and variables and rebuilds shaders (`WebGLTile.js:626-642`; not tagged `@api`). Changing the number of interpolate stops, the palette colours, or the band count needs `setStyle` *(inference: they are baked into GLSL / palette textures)*.
- `variables` is required as soon as a style uses `var` (throws otherwise, `:179-191`).

---

## 4. Data access

**`layer.getData(pixel)`** (`src/ol/layer/BaseTile.js:160-179`; WebGL implementation `src/ol/renderer/webgl/TileLayer.js:319-411`)
- Returns `Uint8ClampedArray | Uint8Array | Float32Array | DataView | null`: the band values of the nearest source pixel from the **CPU-side tile data** (`TileTexture.js:369-443`), searching from the current z down to `minZoom` for a loaded tile in the texture cache; `null` outside the layer extent or for empty tiles. For image tiles it reads one pixel through a 1x1 2D canvas (`TileTexture.js:334-367`).
- Values are pre-style: for GeoTIFF with `normalize: true` they are the 0..255 bytes, not the original values; with `normalize: false` they are raw floats; the alpha band is included (`cog-math.js:79-90` computes NDVI from it). Reprojected tiles are `ReprojDataTile extends DataTile` (`src/ol/reproj/DataTile.js:75`), so values come from the reprojected (resampled) tile.
- Canvas `ol/layer/Tile` `getData` returns RGBA bytes from images only and requires `crossOrigin` (`src/ol/renderer/canvas/TileLayer.js:298-374`).

**`ol/source/Raster`** (`src/ol/source/Raster.js`, an `ImageSource`, `:634`; rendered with the canvas `ol/layer/Image`)
- Inputs (`sources`) are sources or layers (`:581-593`). Each input is rendered by its layer (a canvas `TileLayer`/`ImageLayer` is created for bare sources, `:1269-1297`) and read back as RGBA `ImageData` (`:1200-1250`). Exception: a `DataTileSource` that is not an `ImageTile` source, passed directly, is sampled as native typed arrays through the canvas tile renderer's `readData` (all bands, native precision, nearest resampling, no gutter, `'pixel'` ops only) (`:588-593, 944-958, 1188-1193`; `src/ol/renderer/canvas/TileLayer.js:377-470`; changelog `v10.11.0.md:6`).
- `operation(pixels, data)` for `'pixel'` (one array per input, returns `[r,g,b,a]` 0..255) or `operationType: 'image'` (array of `ImageData` -> `ImageData`) (`:486-506, 531-532, 605-609`).
- Workers: `threads` default 1; `0` runs on the main thread through a `setTimeout` "faux worker"; `'image'` ops are forced to 1 thread (`:276-316, 600-604`). The operation is serialized with `toString()` into a Blob worker, so it must be self-contained; helpers go in `lib` (`:151-174, 599`).
- Events `beforeoperations` / `afteroperations` carry a shared `data` object (`:509-527`). `resolutions` restricts when operations run (`:610-612`). `getData(coordinate)` returns each input's values at a coordinate (`:961-1028`).
- When used: arbitrary JS per-pixel or whole-image operations (region growing, contours, CPU hillshade, colour-space work), output is an 8-bit RGBA image layer. Per-pixel colour mapping that fits the expression language is done on the GPU with `WebGLTile` instead. Examples `raster`, `sea-level`, `shaded-relief` (`'image'` op), `color-manipulation`, `region-growing`, `contour-interpolation`, `cog-math-raster`.

---

## 5. Other raster paths: WebGL vs canvas 2D

| Path | Source base | Rendered by | Ref |
|---|---|---|---|
| `ol/source/ImageTile` (URL template/loader, images) | `DataTileSource` | canvas `ol/layer/Tile` **or** `ol/layer/WebGLTile` | `src/ol/source/ImageTile.js:150-199`; canvas draws image-like DataTile data (`renderer/canvas/TileLayer.js:1093-1101`) |
| `XYZ`, `OSM`, `WMTS`, `TileWMS`, `TileJSON`, ... | `TileImage` -> `UrlTile` -> `TileSource` | canvas `ol/layer/Tile`; also accepted by `WebGLTile` (`TileTexture` uploads `ImageTile`/`ReprojTile` images, `TileTexture.js:221-238`; `reprojection.js:6,79-110` uses WebGLTile with OSM/TileWMS/WMTS) | `src/ol/source/XYZ.js:74`, `WMTS.js:71`, `TileImage.js:67` |
| `GeoTIFF`, `GeoZarr`, custom `DataTile` with arrays, `SentinelHub` | `DataTileSource` | **WebGL only** (`WebGLTile`); the canvas tile renderer throws "Rendering array data is not yet supported" (`renderer/canvas/TileLayer.js:1101`); CPU access via `Raster` `readData` | `src/ol/source/SentinelHub.js:413` |
| `ImageStatic`, `ImageWMS`, `ImageArcGISRest`, ... | `ImageSource` | canvas `ol/layer/Image` (`src/ol/layer/Image.js:30-32`); no WebGL image layer exists in `src/ol/layer/` | `src/ol/source/ImageStatic.js:32` |
| `Raster` | `ImageSource` | canvas `ol/layer/Image` | `src/ol/source/Raster.js:634` |
| `ol/layer/Flow` (wind particles from a DataTile u/v source) | `BaseTileLayer` | WebGL; "Experimental", no `@api` | `src/ol/layer/Flow.js:396-397` |

Canvas `ol/layer/Tile` renderer: `src/ol/layer/Tile.js:30-34` -> `CanvasTileLayerRenderer`.

---

## 6. Examples (`examples/`)

**COG / GeoTIFF (all `WebGLTile` + `GeoTIFF` unless noted)**
- `cog` - single RGB COG (Sentinel-2 TCI), view from `getView` helpers.
- `cog-blob` - COG from a `Blob`.
- `cog-colors` - NDVI with a dynamic colour ramp built from style variables + `updateStyleVariables`.
- `cog-custom-client` - per-source `loader(url, headers, signal)` (auth headers hook).
- `cog-math` - NDVI from two single-band COGs with a static `interpolate` ramp; `getData` readout.
- `cog-math-multisource` - NDVI+NDWI from two 16-bit COGs at 10 m and 60 m (resolution-factor stacking, `nodata: 0`).
- `cog-math-raster` - NDVI on the CPU with a `Raster` source fed a `normalize: false` GeoTIFF (native float values) + `Raster#getData`.
- `cog-modeltransformation` - COG with a rotated `ModelTransformation` (Umbra SAR) over OSM, plus `TileDebug`.
- `cog-overviews` - GeoTIFF with an external `.ovr` overview file.
- `cog-projection` - EPSG:27700 COG with `loadMissingProjection: true` + proj4; the XYZ basemap is reprojected into the COG's CRS.
- `cog-pyramid` - pyramid of many GeoTIFFs via `sources: sourcesFromTileGrid(...)`, EPSG:4326 view.
- `cog-stretch` - band selection and per-channel contrast stretch via variables on a 16-bit `normalize: false` COG.
- `cog-style` - switching true colour / false colour / NDVI / `palette` styles with `setStyle`.
- `geotiff-per-band-stats` - per-band `min`/`max` arrays and `nodata`.
- `geotiff-reprojection` - UTM COG in the default EPSG:3857 view (no proj4 needed for UTM).
- `multiple-cogs` - two COGs in different UTM zones in one `WebGLTile` via `sources: [..]`, band picked by variable, alpha `['band', 5]`, view from a `Promise`.
- `stac-item` - STAC item rendered with the external `ol-stac` layer (uses COGs + proj4).
- `export-map` - exports the map canvas as a GeoTIFF (geotiff.js `writeArrayBuffer`) or PNG + world file (not a rendering feature).

**GeoZarr (`WebGLTile` + `GeoZarr` over OSM)**
- `geozarr` - Sentinel-2 RGB from a multiscales group (URL picker).
- `geozarr-datacube` - `variable` + `dimensions` on n-D cubes (FTW field probabilities, USGS DEM, ERA5 hurricane), proj4 registered.
- `geozarr-dimensions` - time slider via `getDimensions`, `getValue`, `updateDimensions` (Sentinel-1 RTC).
- `geozarr-groups` - bands from several groups (`{name, group}`), cloud mask by threshold variable.
- `geozarr-sparse` - bands at different resolutions, CPU resampling.
- `geozarr-storytelling` - Sentinel-1 scenarios across orbit groups and time.
- `geozarr-stretch` - band selection and contrast stretch.

**DataTile / WebGL tile styling**
- `data-tiles` - generated canvas tiles from a loader.
- `numpytile` - 16-bit NumpyTiles from TiTiler converted to Float32, 5 bands, min/max variables.
- `pmtiles-elevation` - Terrarium PNG from PMTiles, GPU hillshade with neighbour sampling.
- `pmtiles-image` - image tiles from PMTiles (`ImageTile` + loader).
- `webgl-tiles` - basic `WebGLTile` with `ImageTile`.
- `webgl-tile-style` - exposure/contrast/saturation sliders via variables.
- `webgl-sea-level` - Terrain-RGB decode + `case` on a level variable.
- `webgl-shaded-relief` - GPU hillshade with `['band', n, dx, dy]` and `['resolution']`.
- `webgl-layer-swipe` - cropping a WebGL tile layer.
- `wms-time-webgl` - smooth WMS `TIME` changes (stale tiles).
- `reusable-source` - `ImageTile#setUrl` updates.
- `xyz-esri`, `xyz-retina`, `full-screen`, `layer-opacity`, `tracing`, `icon-sprite-webgl` - basemaps on `WebGLTile` (not raster-analysis features).
- `sentinel-hub`, `sentinel-hub-custom-script`, `sentinel-hub-custom-format`, `sentinel-hub-date-picker` - `SentinelHub` DataTile source (server-side evalscripts).
- `wind` - `Flow` layer over a Float32 DataTile; `wind-arrows` is vector arrows (no raster rendering).
- `contour-interpolation` - float DEM `DataTile` with gutter and linear float interpolation, contours from a `Raster` `'image'` op.

**CPU `Raster` source (canvas)**
- `raster` - VARI vegetation index per pixel with a histogram.
- `sea-level` - flood fill by elevation threshold (Terrain-RGB).
- `shaded-relief` - hillshade as an `'image'` operation.
- `color-manipulation` - colour-space (HCL) adjustments with `lib`.
- `region-growing` - flood fill from a clicked seed (`'image'` op).
- `image-filter` - convolution on canvas `postrender` events (not a Raster source).

**Reprojection / static images (canvas unless noted)**
- `reprojection` - OSM/WMS/WMTS reprojected between several CRSs, on `WebGLTile`.
- `reprojection-by-code` - OSM to an arbitrary CRS found by code search (canvas `Tile`).
- `reprojection-image` - `ImageStatic` reprojected (canvas `Image`).
- `reprojection-wgs84` - OSM in EPSG:4326 (canvas `Tile`).
- `static-image` - `ImageStatic` (canvas `Image`).
- `tile-transitions` - custom tile transition settings (canvas `Tile`).

**(a) Minimal COG** (`examples/cog.js:1-26`)
```js
import Map from 'ol/Map.js';
import {getView, withExtentCenter, withHigherResolutions} from 'ol/View.js';
import TileLayer from 'ol/layer/WebGLTile.js';
import GeoTIFF from 'ol/source/GeoTIFF.js';

const source = new GeoTIFF({
  sources: [{url: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/.../TCI.tif'}],
});
const map = new Map({
  target: 'map',
  layers: [new TileLayer({source})],
  view: getView(source, withHigherResolutions(1), withExtentCenter()),
  // or simply: view: source.getView()   (cog-overviews.js:21)
});
```

**(b) NDVI band math with a colour ramp** (`examples/cog-math.js:5-77`, abridged)
```js
const source = new GeoTIFF({
  sources: [
    {url: '.../B04.tif', max: 10000}, // red  -> band 1
    {url: '.../B08.tif', max: 10000}, // nir  -> band 2
  ],
});
const layer = new TileLayer({
  source,
  style: {
    color: [
      'interpolate', ['linear'],
      ['/', ['-', ['band', 2], ['band', 1]], ['+', ['band', 2], ['band', 1]]],
      -0.2, [191, 191, 191],
      0, [255, 255, 224],
      0.2, [145, 191, 82],
      0.65, [0, 69, 0], // ...20 stops in the example
    ],
  },
});
```
Dynamic variant (`examples/cog-colors.js:50-92`): stops are `['var', 'value' + i]` and colours `['color', ['var', 'red' + i], ['var', 'green' + i], ['var', 'blue' + i]]`, updated with `layer.updateStyleVariables(getVariables())`. Palette variant (`cog-style.js:75-89`): `['palette', ['interpolate', ['linear'], ndvi, -0.2, 0, 0.65, 4], ['#0d0887', '#7e03a8', '#cb4778', '#f89540', '#f0f921']]`.

**(c) A COG in a projection other than its own**
- UTM COG on the default Web Mercator view (`examples/geotiff-reprojection.js:7-36`; reprojection is implicit):
```js
const source = new GeoTIFF({sources: [{url: '.../S2A_36QWD_.../TCI.tif'}]}); // EPSG:32636
const map = new Map({
  target: 'map',
  layers: [new TileLayer({source})],
  view: new View({center: [0, 0], zoom: 12}), // EPSG:3857
});
source.getView().then((sourceView) => {
  const view = map.getView();
  view.setCenter(transform(sourceView.center, sourceView.projection, view.getProjection()));
});
```
- Unknown EPSG fetched at runtime (`examples/cog-projection.js:13-50`): `register(proj4)` then `new GeoTIFF({sources: [{url, nodata: 0}], loadMissingProjection: true})` (EPSG:27700), `view: cogSource.getView()`; here the XYZ basemap is the one reprojected.
- Two UTM zones into EPSG:3857 with explicit `proj4.defs` (`examples/multiple-cogs.js:9-11, 66-88`).

---

## 7. Limitations visible in code/docs

- **2D only.** Rotation yes (`TileLayerBase.js:353-377, 575`); no pitch, perspective, 3D terrain or globe: no `pitch`/`tilt`/`globe`/`perspective` in `View.js`, `Map.js`, `TileLayerBase.js` (grep); the tile transform is a 2D affine (`:569-581`).
- **WebGL 1 / GLSL ES 1.00 only** (`webgl.js:87`; no WebGL2 anywhere). Float textures depend on `OES_texture_float` and linear float filtering on `OES_texture_float_linear` (`TileTexture.js:59-67`); without the latter, float data silently falls back to NEAREST, and `contour-interpolation.js:240-244` alerts. The context is created with `preserveDrawingBuffer: true` and antialias off on affected Safari (`webgl.js:94-99`).
- **Data types**: GPU textures only uint8 (normalized) and float32. No uint16/int16/int32/float64 textures; GeoTIFF quantizes to 8 bits by default or expands to float32; GeoZarr always float32; int32/uint32/float64 lose precision as float32 *(inference)*. No integer (exact) sampling.
- **Band count**: no explicit maximum; bounded by texture units (`4 x (MAX_TEXTURE_IMAGE_UNITS - palettes)`) with no check *(inference)*. Per-fragment `band` lookup is an if-chain over all bands (`gpu.js:379-402`).
- **GeoTIFF**: float32 default range unusable without `min`/`max` (`:381-383, 413-415`); multi-file stacking requires identical origin and tile layout (`:773-832`); `overviews` cannot be combined with a custom `loader` (`:288-292`); no user-defined (32767) CRS parsing (`:193`); compose runs on the main thread (`:1096-1270`).
- **GeoZarr**: experimental (`changelog/v10.8.0.md:3`), no `@api`; loads not abortable (no `signal`); no `interpolate`/normalization options; one fill value for all bands; descending x unsupported (`:1290-1292`); can fall back to EPSG:4326 from degree-like extents (`:1574-1585`); legacy TMS tile sizes capped at 512 (`:1868-1893`); decode + compose on the main thread.
- **Reprojection knobs (user-facing only)**: automatic whenever a source has a projection that is not equivalent to the view projection, or has a `transformMatrix` (`DataTile.js:322-337`, `TileImage.js:236-249`); no on/off flag; "off" means using the source projection for the view (`source.getView()`) or leaving the source projection unset. `TileImage` family: `reprojectionErrorThreshold` (default 0.5 px, `TileImage.js:27-28, 126`, `src/ol/reproj/common.js:10`), `setRenderReprojectionEdges` (debug, `TileImage.js:304`), `setTileGridForProjection` (`:324`). `DataTile` family (GeoTIFF, GeoZarr, custom): only `setTileGridForProjection` (`DataTile.js:501`); no error-threshold option (the reprojected tile accepts `errorThreshold`, `src/ol/reproj/DataTile.js:59, 226-229`, but `getReprojTile_` never passes it, `DataTile.js:284-304`). Neighbour `gutter` is dropped when reprojecting (`DataTile.js:233-243`). CRS definitions come from built-ins (3857, 4326, UTM) or `register(proj4)` + `proj4.defs` / `fromProjectionCode` (spatialreference.org).
- **Experimental / non-API markers**: GeoZarr (changelog + no `@api`), `Flow` layer ("Experimental layer", `Flow.js:397`, no `@api`), `WebGLTileLayer#setStyle` and `getSources` have no `@api` (`WebGLTile.js:381, 634`). `useInterimTilesOnError` is deprecated (`BaseTile.js:46`).
- **Canvas tile layer cannot render array data** (`renderer/canvas/TileLayer.js:1101`); `Raster` `readData` does not support gutters or `DataView` (`renderer/canvas/TileLayer.js:395-398, 446-449`).
- **Known example caveats**: `wind.js:66` (transition must be 0, issue 16119); `contour-interpolation.js:99` (one layer shared by two Raster sources breaks rendering).
