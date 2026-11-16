# deck.gl-raster: raster rendering features and user-facing API

**Question (as asked):** What raster rendering features and user-facing API does deck.gl-raster offer: its layers and props, GPU modules, data and format support, views and integration, examples, documentation and setup, and limitations? These notes feed a comparison with OpenLayers' raster support.

- Repo: deck.gl-raster `main` @ `a72d7a14` (2026-11-06). All packages are `0.10.0-beta.4` (`packages/deck.gl-raster/package.json:3`). Paths below are repo-relative unless absolute.
- Read-only survey: nothing was built or run. A claim marked "inferred" comes from reading code, not from running it.
- Out of scope (another researcher): the mesh internals in `packages/raster-reproject` and the tile traversal / LOD code in `packages/deck.gl-raster/src/raster-tileset/`. Only their user-facing knobs are listed here.
- Provenance: sections 1, 2, 4 and 7.0 were written straight from the code. Sections 3, 5, 6 and 7.1-7.5 were drafted by two parallel sub-researchers and spot-checked here. Re-read and confirmed: the epsg.io resolver, decoder pool size, range-reader cache budgets and merge defaults, `GeoTIFF.fromUrl` cache budgets, the Vite worker note, the NAIP NDVI code, the custom-projection code, the land-cover integer module, the vrt-mosaic float pipeline, and the globe and MapLibre overlay setup.

---

## 0. Key findings

1. **Model.** deck.gl layers (WebGL2 only; deck.gl and luma.gl `^9.4` peers) that reproject on the client. Each tile is a texture on an adaptive triangle mesh, warped from the source CRS into Web Mercator common space (or lng/lat on a globe). Any CRS that proj4 can express renders without a tile server, including rotated or skewed affine grids. All pixel styling runs in GLSL shader modules.
2. **Layers.**
   - `COGLayer`: one COG, with a default pipeline for unsigned integers only.
   - `MultiCOGLayer`: the band files of one scene, composited into up to 4 channels.
   - `MosaicLayer`: many items, each opened and drawn by app callbacks (STAC search results, GDAL VRT).
   - `ZarrLayer`: GeoZarr. The app must write `getTileData` and `renderTile`, and pick a slice of every extra dimension with `selection`.
   - `RasterTileLayer`: any tile grid, including an OGC TileMatrixSet.
   - `RasterLayer`: one image.
3. **Pipeline.** `renderTile` returns `RasterModule[]`: luma.gl shader modules, run in order inside `DECKGL_FILTER_COLOR`.
   - Shipped modules: `CreateTexture`, `CompositeBands`, `FilterNoDataVal`, `MaskTexture`, `LinearRescale`, `Colormap`, and photometric converters.
   - `Colormap` has 107 named colormaps in a shipped sprite, plus a `reversed` flag.
   - Band math such as NDVI means writing a GLSL module; two examples do.
4. **Prior notes, checked against the code:**
   - "uint8/uint16 sampled normalized to 0-1": true for `COGLayer` and `MultiCOGLayer`.
   - "Other types raw as `r32float`": true only for `MultiCOGLayer` (where it is marked experimental).
   - "`COGLayer`'s default pipeline throws for signed ints and floats": true. The error goes to `onError`, the layer draws nothing, and the app is not thrown at. The pipeline also fails, tile by tile, for uint32, 1-bit and more than 4 bands.
5. **Formats.**
   - COG reading uses the project's own `@developmentseed/geotiff` (built on cogeotiff), with Deflate, LZW, ZSTD, LERC, JPEG and WebP in a worker pool. Files must be tiled.
   - Requests go through a range reader that merges them, with a 96 MiB cache and 6 requests per origin.
   - GeoZarr: the `spatial`, `proj` and `multiscales` conventions, read through zarrita. There is no worker pool and no request merging for Zarr.
   - CRS: EPSG codes outside proj4's built-in set are fetched from epsg.io at runtime, unless the app passes an offline resolver.
6. **Views.**
   - Web Mercator `MapView` is the main path. `GlobeView` is preliminary: a uniform 32x32 grid per tile, called "THROWAWAY" in the code.
   - The library has no path for `OrbitView`, `OrthographicView` or custom projections. An experimental example shims custom projections until deck.gl v10.
   - Terrain draping works through deck.gl's experimental `TerrainExtension` plus a `zRange` prop. MapLibre interleaving works through `MapboxOverlay`.
   - The antimeridian and world copies are handled.
7. **Gaps that matter for an OpenLayers comparison:**
   - No API to read a pixel's value: picking returns the whole tile mesh as one object.
   - No style expressions: styling is GLSL.
   - GDAL scale and offset are parsed but never applied.
   - The nodata filter tests the red channel only.
   - Integer textures need hand-written modules.
   - The docs are thin: one intro guide, and bundler guidance for Vite only.

---

## 1. Layers and their props

### 1.1 Packages, class hierarchy, source model

- **`@developmentseed/deck.gl-raster`** exports:
  - `RasterLayer` and `RasterTileLayer` (`packages/deck.gl-raster/src/index.ts:17-26`)
  - `RasterSource`
  - the tile-grid descriptors `AffineTileset`, `AffineTilesetLevel`, `TileMatrixSetAdaptor` and `RasterTileset2D` (`index.ts:38-43`)
  - `DEFAULT_RANGE_READER` (`index.ts:1`)
  - the multi-tileset helpers (`index.ts:11-16`)
  - GPU modules, at the `./gpu-modules` subpath, and the colormap sprite at `./gpu-modules/colormaps.png` (`packages/deck.gl-raster/package.json:13-17`)
- **`@developmentseed/deck.gl-geotiff`** exports `COGLayer`, `MultiCOGLayer`, `MosaicLayer`, `COGSource`, `MultiCOGSource`, `parseVRT`, `DEFAULT_CONCURRENCY_LIMITER`, `addAlphaChannel`, `createTextureProps`, `inferTextureFormat` and `TextureDataT` (`packages/deck.gl-geotiff/src/index.ts:1-19`).
- **`@developmentseed/deck.gl-zarr`** exports `ZarrLayer` and `ZarrSource` (`packages/deck.gl-zarr/src/index.ts:1-8`).
- **Hierarchy:**
  - `COGLayer`, `MultiCOGLayer` and `ZarrLayer` extend `RasterTileLayer` (`packages/deck.gl-geotiff/src/cog-layer.ts:108-110`; `packages/deck.gl-geotiff/src/multi-cog-layer.ts:234-237`; `packages/deck.gl-zarr/src/zarr-layer.ts:143-146`).
  - `RasterTileLayer` is a `CompositeLayer` that renders deck.gl's `TileLayer` with its own `RasterTileset2D` (`packages/deck.gl-raster/src/raster-tile-layer/raster-tile-layer.ts:286-298, 636-726`). Each tile becomes one `RasterLayer` (`raster-tile-layer.ts:812-834`).
  - `RasterLayer` draws a `MeshTextureLayer`, a narrowed `SimpleMeshLayer` that isn't exported (`packages/deck.gl-raster/src/raster-layer.ts:409-420`; `packages/deck.gl-raster/src/mesh-layer/mesh-layer.ts:77-104`).
  - `MosaicLayer` is a separate `CompositeLayer` around deck.gl's `TileLayer`, in which each "tile" is a mosaic item (`packages/deck.gl-geotiff/src/mosaic-layer/mosaic-layer.ts:246-293`).
- **Source model (new in 0.10):**
  - A source layer's `source` prop takes either an opened `RasterSource` subclass or input that the layer opens itself (`raster-tile-layer.ts:212-225, 314-383`).
  - A `RasterSource` is a `tilesetDescriptor` plus `geographicBounds`, in WGS84 degrees; across the antimeridian, `east` can be more than 180 (`packages/deck.gl-raster/src/raster-source.ts:3-38`).
  - A layer that opens its own input uses the default options only. To change the EPSG resolver, the request limiter, the range reader or `requestInit`, the app opens the source itself and passes it in (`cog-layer.ts:79-81, 136-141`; `zarr-layer.ts:66-70, 205-211`).
  - One source can be shared by several layers (`packages/deck.gl-geotiff/src/cog-source.ts:84-89`).

### 1.2 `RasterTileLayer` (base class; also usable directly)

Purpose: draws any tiled raster from a `RasterTilesetDescriptor`, a `getTileData` and a `renderTile` (`raster-tile-layer.ts:261-285`).

Props are `RasterTileLayerProps` (`raster-tile-layer.ts:65-180`), with defaults at `:182-190`:

| Prop | Type / default | Notes | Ref |
| --- | --- | --- | --- |
| `tilesetDescriptor` | `RasterTilesetDescriptor` (direct use only) | Levels coarsest-first, plus `projectTo/From3857` and `projectTo/From4326`. A new object refetches every tile. | `:84-92`; `raster-tileset/tileset-interface.ts:95-125` |
| `getTileData(tile, { device, signal })` | `Promise<DataT>`; `DataT` is `null` or `{ width, height, byteLength? }` | Runs once per (x, y, z) and is cached by the `TileLayer`. Refetch with `updateTriggers.getTileData` (or `.all`). | `:28-60, 104-119, 326-332` |
| `renderTile(data)` | returns `{ image?, renderPipeline? }` or `null` | Runs on every render. Redraw loaded tiles with `updateTriggers.renderTile`. | `:121-131, 707-709` |
| `maxError` | `0.125` | Mesh error, in output pixels. | `:133-141, 184` |
| `debug`, `debugOpacity` | `false`, `0.5` | Draws the mesh and tile outlines. | `:143-153, 185-186`; `layer-utils.ts` |
| `extent` | `[minLng, minLat, maxLng, maxLat]` or `null` | Narrows which tiles load. | `:94-102` |
| `signal` | `AbortSignal` | Combined with each tile's own signal. | `:155-160, 728-743` |
| `zRange` | `[minMeters, maxMeters]` or `null` (compared by value) | Picks tiles for terrain. It doesn't move the raster, and `GlobeView` ignores it. | `:162-179, 189` |
| Passed through to `TileLayer` | `debounceTime`, `maxCacheByteSize`, `maxCacheSize`, `maxRequests`, `maxZoom`, `minZoom`, `onTileError`, `onTileLoad`, `onTileUnload`, `onViewportLoad`, `refinementStrategy`, `tileSize`, `zoomOffset` | deck.gl 9.4 defaults: `maxRequests` 6, `debounceTime` 0, `tileSize` 512, `zoomOffset` 0, `maxCacheSize` null, `refinementStrategy` best-available. | `:68-82, 672-725`; `node_modules/.pnpm/@deck.gl+geo-layers@9.4.0_*/node_modules/@deck.gl/geo-layers/src/tile-layer/tile-layer.ts:31-53` |

- **Zoom props (the traversal researcher's area):**
  - `minZoom` is compared with `viewport.zoom`, but `maxZoom` caps the level index (`raster-tileset/raster-tileset-2d.ts:327-350`). The docstring says both are compared with `viewport.zoom` (`:287-291`).
  - `visibleMinZoom` and `visibleMaxZoom` are deliberately ignored (`:292-297`).
  - `extent` doesn't keep tiles loading below `minZoom` (`:298-299`).
- **Errors go to deck.gl's `onError`; they are not thrown:**
  - A metadata or open failure: `"Metadata loading failed in <LayerName>"` (`:446-476`).
  - A source the layer can't draw, such as when the default pipeline can't be inferred: `"Can't draw the source in <LayerName>"`. The layer then draws nothing (`:424-444`).
  - A mesh failure: `"building the reprojection mesh"` (`raster-layer.ts:292-300`).
  - Tile load errors go to `onTileError`, whose deck.gl default is `console.error` (`tile-layer.ts:42`).
- **Loading and refetching:**
  - `isLoaded` stays false while metadata is loading (`:542-549`).
  - A refetch builds a new inner `TileLayer` with a new id. It doesn't use deck.gl's `reloadAll`, which keeps drawing old tiles ([#818]) (`:493-504, 690-694`).
- **Protected hooks for subclasses:** `_openSource`, `_sourceState`, `loadMetadata` / `shouldLoadMetadata`, `_tilesetDescriptor`, `_getTileDataCallback`, `_renderTileCallback`, `_onTileUnloadCallback`, `_abortUnwantedLoads` (off in the base class) and `_renderDebug` (`:340-622`).
- **Built-in tile grids:**
  - `AffineTileset` / `AffineTilesetLevel` take any affine transform, rotated and skewed ones included. COG and Zarr both use them (`packages/deck.gl-geotiff/src/geotiff-tileset.ts:8-58`).
  - `TileMatrixSetAdaptor` wraps an OGC TMS 2.0 document, for example from titiler (`raster-tileset/tile-matrix-set.ts:160-175`).
  - A custom grid implements `RasterTilesetDescriptor` (`tileset-interface.ts:95-131`).
- **GPU memory:** the base class passes `onTileUnload` through untouched. A `getTileData` that creates textures must destroy them in `onTileUnload` (`:572-581`).

### 1.3 `COGLayer`

- **Purpose:** "renders a COG using a tiled approach with reprojection". For one scene stored as several band files, use `MultiCOGLayer` (`cog-layer.ts:101-107`).
- **Props:** `COGLayerProps<DataT = TextureDataT>` = every `RasterTileLayer` prop except `tilesetDescriptor`, `getTileData` and `renderTile`, plus the following (`cog-layer.ts:65-99`):
  - `source` (required): an opened `COGSource`, or a URL string, `URL`, `ArrayBuffer` or opened `GeoTIFF` (`cog-layer.ts:70-86`; `cog-source.ts:25-32`). A new object starts the tiles over.
  - `onSourceLoad(source)`: called when the layer opened the source itself (`cog-layer.ts:88-92`).
  - `pool`: a `DecoderPool`. Without one, every layer shares `defaultDecoderPool()` (`cog-layer.ts:94-98, 205`).
  - `getTileData(image, options)` and `renderTile(data)`: pass both or neither; the TypeScript union enforces it (`cog-layer.ts:29-60`).
    - `image` is a `GeoTIFF` or `Overview`.
    - `options` is `{ device, signal, x, y, pool }` (`cog-layer.ts:17-27, 191-207`).
    - `renderTile` returns `RenderTileResult | null`.
- **Defaults that differ from `RasterTileLayer`:**
  - `maxRequests: 256` and `debounceTime: 50`. The comment explains: "Release a whole selection to the range reader at once, which merges its reads; the per-origin limiter caps requests" (`cog-layer.ts:112-118`).
  - `_abortUnwantedLoads` is on, so a tile that leaves the view stops its stream (`cog-layer.ts:120-123`).
- **Overviews:** levels run coarsest-first, and `z === overviews.length` is the full-resolution image (`cog-layer.ts:193-199`; `geotiff-tileset.ts:32-49`).
- **Default pipeline:**
  - It is inferred from the GeoTIFF's tags when the source opens, unless the app passes both `getTileData` and `renderTile` (`cog-layer.ts:143-164`). See section 2.3.
  - It is destroyed when the source changes or the layer is removed (`cog-layer.ts:148-150, 166-169`).
  - Its textures are freed on tile unload. Textures made by a custom `getTileData` are not freed (`cog-layer.ts:221-240`).
- **`COGSource.open(input, options)`** (`cog-source.ts:34-82, 108-147`) reads the header, resolves the CRS and builds the tile grid. Its options:
  - `signal`
  - `epsgResolver`: defaults to proj4's built-in codes, else a fetch from epsg.io
  - `concurrencyLimiter`: defaults to 6 requests per origin; `null` turns it off
  - `getPriority`
  - `reader`: defaults to `DEFAULT_RANGE_READER`
  - `requestInit`: headers, credentials and mode, for authentication
- **Extension props** are not part of `COGLayerProps`. Examples build the props as `satisfies COGLayerProps & TerrainExtensionProps`, or use `@ts-expect-error` (`examples/experimental/cog-terrain/src/App.tsx:394-418`).

### 1.4 `MultiCOGLayer`

- **Purpose:** draws several COGs as the bands of **one** image, such as the per-band files of one Sentinel-2 scene (`multi-cog-layer.ts:217-233`).
  - The files must share a CRS, and their edges must agree to within one pixel of the coarser file. Resolutions may differ (`packages/deck.gl-geotiff/src/multi-cog-source.ts:22-62`).
  - The finest file sets the tile grid. Each other band is fetched at its closest resolution, stitched with `assembleTiles`, and sampled through a UV transform (`multi-cog-layer.ts:227-230, 539-633`).
- **Props** (`multi-cog-layer.ts:115-207`): every `RasterTileLayer` prop except `tilesetDescriptor`, `getTileData` and `renderTile`, plus:
  - `source`: a `MultiCOGSource`, or a `Record<bandName, COGInput>`. An empty record draws nothing (`:125-139, 250-256`).
  - `onSourceLoad` (`:141-145`).
  - `composite: { r, g?, b?, a? }`: band names for the output channels. The default is `{ r: firstBand }` (`:147-152, 446-448`). At most 4 distinct bands (`packages/deck.gl-raster/src/gpu-modules/composite-bands.ts:8, 134-140`).
  - `renderPipeline`: modules that run after compositing (`:154-171, 478-484`).
  - `resampling`: `"linear"` (the default) or `"nearest"`. A change applies to loaded tiles without refetching them; formats the device can't filter are always nearest (`:173-194, 460-474`).
  - `debugLevel`: `1 | 2 | 3`, default `1` (`:196-206, 214`).
  - `pool` (`:124`).
- **Defaults:** `maxRequests: 256` and `debounceTime: 50` (`:209-215`); unwanted loads are aborted (`:245-248`).
- **The app cannot supply `getTileData` or `renderTile`.** Rendering is always `CompositeBands` followed by the app's `renderPipeline` (`:476-486`).
- **Texture formats:** see 2.4 (`createBandTexture`, `:800-864`).

### 1.5 `MosaicLayer`

- **Purpose:** a mosaic of many sources, such as the COGs of a STAC search. Only the items in view are opened (`getSource`) and drawn (`renderSource`). An item that leaves the view keeps its opened source but drops its sublayers and their GPU memory ([#803]) (`mosaic-layer.ts:246-289`).
- **Props** (`mosaic-layer.ts:51-199`; defaults `:201-204`):
  - `data`: an array, a promise of one, or a URL (`dataTransform` can turn a STAC search into items) (`:66-84`).
    - Each item is `{ id?, bbox }`, with `bbox` in WGS84. It may cross the antimeridian with `minX > maxX`, as GeoJSON and STAC allow (`mosaic-tileset-2d.ts:19-37`).
    - `id` keys the cache of opened sources. The default, the item's position in the array, is safe only while the array changes by appending (`:78-83`).
  - `extent` (`:86-95`).
  - `concurrencyLimiter`: defaults to `DEFAULT_CONCURRENCY_LIMITER`, 6 per origin (`:97-105, 202`).
  - `reader` and `requestInit` (`:107-117`).
  - `getSource(item, { signal, concurrencyLimiter, reader, requestInit, getPriority })` returns a promise of the item's source (`:119-154`).
  - `renderSource(item, { source, subLayerProps })` returns layers. Required (`:156-172`).
  - `onSourceLoad`, `onSourceError` (not called for aborts; supplying it stops deck.gl's error log), `onSourceUnload` and `onViewportLoad` (`:174-198, 393-453`).
  - From `TileLayer`: `maxCacheSize`, `maxRequests`, `maxZoom` and `minZoom` (`:58-65`).
  - Deliberately not exposed: `debounceTime` ([#562]) and `maxCacheByteSize` ([#803]) (`:60-63`).
- **Request priority:** items are ordered by the distance from their bbox centre to the viewport centre, measured the short way across the antimeridian. The queue re-sorts as the view pans. This works for Web Mercator and globe viewports; other viewports fall back to FIFO (`:206-244`).
- **Reloading:** changing `updateTriggers.getSource` reopens every source (`:127-130, 369-374`). `reloadAll` was overridden to unload items properly ([#816]) (`mosaic-tileset-2d.ts:105-114`).
- **GDAL VRT:** `parseVRT(xml, vrtUrl)` turns a VRT into items (`mosaic-layer/vrt.ts:28-44`). Section 3.7 has the details.

### 1.6 `ZarrLayer`

- **Purpose:** GeoZarr data, single- or multi-resolution. There is no default rendering: the app supplies `getTileData` and `renderTile` (`zarr-layer.ts:134-142`).
- **Props** (`zarr-layer.ts:50-132`): every `RasterTileLayer` prop except `tilesetDescriptor`, `getTileData` and `renderTile`, plus:
  - `source`: a `ZarrSource`, or a zarrita store, group or array. A layer that opens it draws the store's root, since it can't pass a `path` (`:60-77`).
  - `onSourceLoad` (`:79-83`).
  - `selection` (required): `Record<dim, number | zarr.Slice | null>`.
    - It needs exactly one entry per non-spatial dimension; pass `{}` when there are none.
    - It is compared by value, and a change refetches the tiles.
    - A selection that doesn't fit goes to `onError` as `"Can't draw the selection in ZarrLayer"`, and nothing is drawn (`:85-101, 164-199, 289-316`).
  - `getTileData(arr, { device, signal, x, y, z, sliceSpec, width, height })` (required). It calls `zarr.get(arr, sliceSpec)` and converts the result. The y dimension comes before x, and the chunk arrives in the array's own dimension order (`:20-48, 103-123`).
  - `renderTile(data)` (required) (`:125-131`).
- **Defaults:** `TileLayer`'s (`maxRequests` 6, `debounceTime` 0). Unwanted loads are not aborted. No textures are freed automatically: the app's `onTileUnload` must destroy them (`raster-tile-layer.ts:572-589`).
- **Tiles:** levels are finest-first and `z` is coarsest-first (`zarr-layer.ts:239-240`). One tile is one chunk (the inner chunk for sharded arrays; see 3.3), clipped at the array's edges (`zarr-layer.ts:242-251`).
- **`ZarrSource.open(input, { path, geoZarrMetadata, epsgResolver, signal })`** (`packages/deck.gl-zarr/src/zarr-source.ts:35-67, 162`):
  - It exposes `node`, `levels`, `dimensionNames`, `spatialDims` and `projection` (`:88-110`).
  - `source.is("float32")` narrows the data type (`:129-135`).

### 1.7 `RasterLayer` (a single image)

- **Purpose:** a "generic deck.gl layer for rendering geospatial raster data with client-side, GPU-based reprojection and custom processing pipelines" (`raster-layer.ts:152-161`).
- **Props** (`raster-layer.ts:68-141`; defaults `:143-150`):
  - `width` and `height` (required).
  - `reprojectionFns` (required): `{ forwardTransform, inverseTransform, forwardReproject, inverseReproject }`. The first pair is pixel to source CRS and back; the second is source CRS to output and back (`packages/raster-reproject/src/delatin.ts:108-132`).
  - `image`, `renderPipeline`, or both (`raster-layer.ts:57-66, 95-113`).
    - `image` is any luma.gl `TextureSource`: a URL, `HTMLImageElement`, `ImageData` and so on. deck.gl loads it asynchronously (`raster-layer.ts:143-147`).
    - When both are given, `image` goes first, as a `CreateTexture` module (`mesh-layer.ts:124-130`).
  - `maxError`: default `0.125` (`raster-layer.ts:23, 115-122`).
  - `initialTriangulation`: a seed mesh, used for example to clamp to Web Mercator's latitude band (`:87-93`).
  - `_wrapX`: "@internal Experimental" (`:124-134`).
  - `debug` and `debugOpacity`: draw the triangles with a `PolygonLayer` (`:136-140, 330-394`).
- **Mesh rebuild:** when the data, size, `reprojectionFns` members, `maxError`, `initialTriangulation` or `_wrapX` change (`:197-227`).
- **Mesh error space:** the error is measured in output pixels, hard-coded as `_errorSpace: "output"` (`:284-291`). **`_errorSpace` is not a layer prop.** It is an option only of `RasterReprojector` in raster-reproject, where it defaults to `"input"` (`delatin.ts:231, 254`).
- **Coordinates:** positions are fp64-split for precision at high zoom (`raster-layer.ts:451-453`). The mesh lies flat at `z = 0` (`:447-448`).
- **`MeshTextureLayer` (internal):**
  - Unlit: raster pixels are drawn as they are, so `material` is unsupported (`mesh-layer.ts:94-95`; `mesh-layer-fragment.glsl.ts:10-14`).
  - It honours `opacity` (`mesh-layer-fragment.glsl.ts:33`).
  - The per-instance placement props are fixed at identity (`mesh-layer.ts:16-36`).
  - WebGL only: upstream's WGSL shader is dropped (`mesh-layer.ts:96-97, 184-188`).

### 1.8 Callbacks across layers

| Callback | Layers | Ref |
| --- | --- | --- |
| `onSourceLoad(source)` | COG, MultiCOG, Zarr (input opened by the layer) | `cog-layer.ts:88-92`; `multi-cog-layer.ts:141-145`; `zarr-layer.ts:79-83` |
| `onSourceLoad(item, { source })`, `onSourceError(item, { error })`, `onSourceUnload`, `onViewportLoad(entries)` | Mosaic | `mosaic-layer.ts:174-198, 404-453` |
| `onTileLoad`, `onTileUnload`, `onTileError`, `onViewportLoad` | all `RasterTileLayer`s, passed to `TileLayer` | `raster-tile-layer.ts:68-82, 721-724` |
| `onError` (deck.gl's) | metadata, source, selection and mesh errors | `raster-tile-layer.ts:424-476`; `zarr-layer.ts:188-195`; `raster-layer.ts:292-300` |

---

## 2. GPU modules (`packages/deck.gl-raster/src/gpu-modules`)

### 2.1 How a pipeline works and how a user composes one

- **Type:** `RasterModule = { module: ShaderModule<PropsT>; props?: Partial<PropsT> }`. Prop values can be `number | boolean | readonly number[] | Texture` (`gpu-modules/types.ts:4-21`). It is exported from the package root and from `/gpu-modules` (`index.ts:2`; `gpu-modules/index.ts:29`).
- **Where pipelines come from:**
  - For tile layers, `renderTile` returns `{ renderPipeline }` or `{ image }` (`raster-layer.ts:57-66`).
  - `MultiCOGLayer` instead takes a `renderPipeline` prop, which runs after `CompositeBands` (`multi-cog-layer.ts:478-484`).
  - `packages/deck.gl-raster/GPU_MODULES.md:3` says `RasterTileLayer` has a `renderPipeline` prop; it doesn't (it has `renderTile`).
- **Shader assembly:**
  - `MeshTextureLayer` adds each module to the luma.gl shader (`mesh-layer.ts:184-204`).
  - The fragment shader sets `color = vec4(0.0)`, runs the `DECKGL_FILTER_COLOR` hook (where each module injects GLSL), then writes `fragColor = vec4(color.rgb, color.a * layer.opacity)` (`mesh-layer-fragment.glsl.ts:26-34`).
  - "Pipelines run in order: each module receives the output of the previous one" (`GPU_MODULES.md:17`).
- **Updates:**
  - Module props are set on every draw, keyed by `module.name` (`mesh-layer.ts:206-218`). Changing only props doesn't recompile the shader.
  - Changing the module list (its length or names) recompiles it (`mesh-layer.ts:136-182`).
  - Inferred: two copies of one module in a pipeline share one props slot, so they can't take different props.
- **Writing a custom module** (the pattern of the shipped ones, e.g. `filter-nodata.ts:13-44`, `linear-rescale.ts:29-52`, `colormap.ts:33-65`):
  - Write a luma.gl `ShaderModule` with a `name`.
  - Declare scalar uniforms as a GLSL block `uniform <name>Uniforms { ... } <name>;`, with `uniformTypes` and `getUniforms`. The block name must match the module name ("This module name must be consistent", `filter-nodata.ts:13`).
  - Declare textures in `inject["fs:#decl"]` and bind them in `getUniforms` (`create-texture.ts:15-27`).
  - Put the logic in `inject["fs:DECKGL_FILTER_COLOR"]`, reading and writing `color` and `geometry.uv`; it may call `discard`.
- **Language:** GLSL 300 es only (WebGL2) (`mesh-layer.ts:96-97`).

### 2.2 Module catalog (`gpu-modules/index.ts:1-29`)

| Export | `name` | What it does | Props (default) | Ref |
| --- | --- | --- | --- | --- |
| `CreateTexture` | `create-texture-unorm` | `color = texture(textureName, uv)` through a float `sampler2D`. The usual first module. | `textureName` | `create-texture.ts:10-28` |
| `CompositeBands` + `buildCompositeBandsProps(mapping, bands)` | `compositeBands` | Samples `.r` of up to 4 band textures, each with its own UV transform `uv * zw + xy`, into RGBA through `channelMap`. A missing alpha is 1.0. The helper turns named bands into slots and fills unused samplers with a placeholder. | `band0`-`band3`, `uvTransform0`-`3` (`[0,0,1,1]`), `channelMap` (`[0,1,2,-1]`) | `composite-bands.ts:30-104, 106-183` |
| `FilterNoDataVal` | `nodata` | `discard` where `color.r == value`, or where both are NaN. Red channel only. | `value` | `filter-nodata.ts:22-44` |
| `MaskTexture` | `mask-texture` | `discard` where the mask texture's `.r == 0.0` (expects nearest sampling). | `maskTexture` | `mask-texture.ts:10-34` |
| `LinearRescale` | `linearRescale` | `color.rgb = clamp((rgb - min) / (max - min), 0, 1)`. | `rescaleMin` (0), `rescaleMax` (1) | `linear-rescale.ts:15-52` |
| `Colormap` | `colormap` | `color = texture(colormapTexture, vec3(r or 1-r, 0.5, colormapIndex))`. The texture must be a 2D **array**, one layer per colormap. | `colormapTexture`, `colormapIndex` (0), `reversed` (false) | `colormap.ts:4-65` |
| `BlackIsZero` / `WhiteIsZero` | `black-is-zero` / `white-is-zero` | Gray (`color.r`) to RGB, plain or inverted. | none | `color/black-is-zero.ts:9-22`; `color/white-is-zero.ts:9-22` |
| `GrayAlpha` | `gray-alpha` | `color.a = color.g`, for gray+alpha images. Must run before the gray-to-RGB module. | none | `color/alpha.ts:18-31` |
| `Opaque` | `opaque` | `color.a = 1.0`, for a fourth band that isn't alpha, such as NAIP's near-infrared. | none | `color/alpha.ts:3-16` |
| `CMYKToRGB` | `cmyk-to-rgb` | CMYK (RGBA read as C, M, Y, K) to RGB. | none | `color/cmyk.ts:16-29` |
| `YCbCrToRGB` | `ycbcr-to-rgb` | JFIF YCbCr to RGB. | none | `color/ycbcr.ts:18-32` |
| `cieLabToRGB` | `cielab-to-rgb` | CIE L\*a\*b\* (D65) to sRGB. | none | `color/cielab.ts:47-60` |

Colormap helpers:
- `COLORMAP_INDEX` maps 107 matplotlib and rio-tiler names, from `accent: 0` to `ylorrd: 106` (cfastie, viridis, turbo, terrain, rdylgn, and others). Reversed `_r` variants aren't listed separately; the `reversed` prop flips any colormap (`colormap-names.ts:1-19, 19-127`).
- The sprite ships as `@developmentseed/deck.gl-raster/gpu-modules/colormaps.png` (`package.json:17, 24`).
- `decodeColormapSprite(ArrayBuffer | Uint8Array | ImageBitmap)` returns `ImageData`, decoded with `createImageBitmap` and an `OffscreenCanvas`; it needs no GPU device (`decode-colormap-sprite.ts:1-60`).
- `createColormapTexture(device, imageData)` requires a 256-pixel-wide image and makes each row one layer of an `rgba8unorm` 2D-array texture, with linear filtering and clamping (`create-colormap-texture.ts:3-51`).
- A custom colormap is any 256-wide image (`colormap.ts:7-11`).

### 2.3 `COGLayer`'s default pipeline (`packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts`)

- **Which data gets it:** `inferRenderPipeline` switches on `SampleFormat[0]` and handles only `SampleFormat.Uint`. Anything else throws `"Inferring render pipeline for non-unsigned integers not yet supported"`, and so does a missing `SampleFormat` tag (`render-pipeline.ts:68-94`).
- **Module order** (`:119-162`):
  1. `CreateTexture(tile texture)`
  2. `Opaque` or `GrayAlpha`, when needed
  3. `FilterNoDataVal(nodata / (2^bits - 1))`, when the file has a `GDAL_NODATA` tag
  4. `MaskTexture(tile mask)`, when the file has a mask IFD
  5. One of `WhiteIsZero`, `BlackIsZero`, `Colormap` (from the TIFF palette), `CMYKToRGB` or `cieLabToRGB`, by photometric interpretation
- **Alpha** (`:263-294`):
  - A 4-band RGB image whose fourth band isn't alpha gets `Opaque`. "Alpha" means the band's `ExtraSamples` value is associated or unassociated alpha (`packages/geotiff/src/colorinterp.ts:77-91`).
  - A 2-band gray image whose second band is alpha gets `GrayAlpha`.
  - So NAIP (RGBN) is drawn opaque, as RGB. `examples/experimental/cog-terrain/README.md:116-117` says the default pipeline "would draw the fourth band as alpha"; that is out of date ([#732]; `docs/blog/v0.9-release.md:140` matches the code).
- **Photometric interpretation** (`:296-374`):
  - **Any 3- or 4-band image is drawn as RGB(A) before the photometric is checked** (`:307-310`).
  - YCbCr gets no module, because the browser's JPEG decoder already converted it (`:361-365`).
  - Palette gets the TIFF `ColorMap` through `parseColormap`, uploaded as a 2D-array `rgba8unorm` texture with nearest sampling. All tiles share it, and it is destroyed with the pipeline (`:325-354, 252-258`).
  - Any other photometric throws `"Unsupported PhotometricInterpretation"` (`:371-372`).
- **Tile data** (`:177-245`):
  - `image.fetchTile(x, y, { boundless: false, pool, signal })`.
  - Band-separate data is interleaved on the CPU (TODO [#772]).
  - A 3-band image gets an alpha channel ("WebGL2 doesn't have an RGB-only texture format").
  - The format comes from `inferTextureFormat`, swapped for the norm16 fallback where needed.
  - Sampling is linear, except for palettes and formats the device can't filter, which are nearest.
  - The mask becomes an `r8unorm` texture with nearest sampling.
  - The result is `TextureDataT { texture, mask?, width, height, byteLength }` (`:32-47`).

### 2.4 Texture formats per data type

| Data | `COGLayer` default pipeline | `inferTextureFormat` (exported, for a custom `getTileData`) | `MultiCOGLayer` (`createBandTexture`) | Values the shader sees |
| --- | --- | --- | --- | --- |
| uint8 | `r8unorm`, `rg8unorm` or `rgba8unorm` (3 bands padded to RGBA) | same | `r8unorm` | 0-1 |
| uint16 | `r16unorm`, `rg16unorm` or `rgba16unorm`. Without `EXT_texture_norm16` (e.g. Firefox), the `*32float` counterpart with samples divided by 65535 | same | `r16unorm`, same fallback | 0-1 |
| uint32 | **fails on every tile**: there is no `unorm:32` entry | throws | `r32float` | raw |
| 1-bit | **fails on every tile**: bits must be 8, 16 or 32 | throws | decoded to 0/255 `Uint8Array`, so `r8unorm` (inferred) | 0-1 |
| int8 / int16 / int32 | **refused** (no default pipeline) | `r8sint`, `r16sint`, `r32sint` (and `rg`/`rgba` variants): integer formats that the shipped `sampler2D` modules can't read | `r32float` (experimental) | raw |
| float32 | **refused** | `r32float`, `rg32float`, `rgb32float-webgl`, `rgba32float` | `r32float` (experimental) | raw |
| float64 | **refused** | throws (64 bits isn't allowed) | `r32float`, rounded to float32 | raw |
| more than 4 bands | **fails on every tile** ("Only 1, 2, 3, or 4") | throws | n/a (single-band files assumed, inferred) | n/a |
| ZarrLayer | app's choice; examples use `r32float`, an `r8sint` 2D array, or `ImageData` through `image` (see 5.1) | n/a | n/a | n/a |

- Refs: `texture.ts:38-57` (inference); `:63-124` (checks: Uint maps to `unorm`, Int to `sint`, Float to `float`); `:142-198` (`FORMAT_TABLE`); `:200-234` (norm16 fallback); `multi-cog-layer.ts:800-864`; `packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts:197-219`.
- The `uint` entries in `FORMAT_TABLE` (`r8uint` and so on) can never be returned, because `inferScalarKind` never returns `"uint"` (`texture.ts:114-123` vs `:145, 151, 162`).
- **Filtering:** `isFilterable` reports 32-bit float formats as linear-filterable only when the device has `float32-filterable`; luma.gl reports them all as filterable on WebGL2 (`texture.ts:236-247`).
- **Integer textures need a custom module** with `usampler2D`/`isampler2D`. `CreateTexture` and `CompositeBands` declare `sampler2D` (`create-texture.ts:18`; `composite-bands.ts:47-50`). Example: land-cover's `CreateTextureUint` reads an `r8uint` texture through `usampler2D` (`examples/land-cover/src/gpu-modules/create-texture-uint.ts:22-35`; `examples/land-cover/src/get-tile-data.ts:13-50`).

### 2.5 The prior notes, checked against the code

1. **"uint8/uint16 are sampled normalized to 0-1."** True for `COGLayer`'s default pipeline (`texture.ts:115-116, 142-198`) and for `MultiCOGLayer` (`multi-cog-layer.ts:161-162, 833-836`). The norm16 fallback divides by 65535, so shaders read the same 0-1 values (`texture.ts:200-234`).
2. **"Other types raw as `r32float`."** True only for `MultiCOGLayer`: signed ints, uint32, float32 and float64 are all uploaded as `r32float`, and its docs say "**experimental**, and the units they arrive in are likely to change" (`multi-cog-layer.ts:163-167, 811-818, 837-846`). For `COGLayer` it is false: those types have no default pipeline, and the exported `inferTextureFormat` maps signed ints to integer formats such as `r16sint`, not to `r32float` (`texture.ts:117-120, 144-171`).
3. **"COGLayer's default pipeline throws for signed ints and floats."** True: `render-pipeline.ts:85-93`.
   - Nuances:
     - The throw happens in `_sourceState` when the source opens (`cog-layer.ts:155-161`). `_setSource` catches it, reports it to `onError` as `"Can't draw the source in COGLayer: ..."`, and the layer draws nothing; the app's code never sees the throw (`raster-tile-layer.ts:424-444`).
     - Inference is skipped only when the app passes **both** `getTileData` and `renderTile` (`cog-layer.ts:155`).
     - Unsigned files can still fail, tile by tile, through `onTileError`: uint32, 1-bit, and more than 4 bands (`texture.ts:63-97, 142-198`).
   - The docs say so too: "The COG layer's default pipeline only handles unsigned integers, so float data needs its own `getTileData` and `renderTile`" (`examples/vrt-mosaic/src/elevation.ts:38-39`).

### 2.6 NDVI-style band math

- **One multi-band COG** (`naip-mosaic`, the most complete example):
  - A custom `getTileData` uploads R, G, B, NIR as one `rgba8unorm` texture.
  - A module `normalizedDifference` writes `color.r = (nir - red) / (nir + red)`, reading `color[3]` and `color[0]` (`examples/naip-mosaic/src/App.tsx:150-164`).
  - An `ndviFilter` module discards values outside `[ndviMin, ndviMax]`.
  - `LinearRescale(-1, 1)`, `Colormap`, then `SetAlpha1`, returned from `renderTile` (`App.tsx:256-286`).
  - The colormap texture is built once the device exists (`App.tsx:366-397`). The code is quoted in 5.3.
  - Simpler variant: `vermont-cog-comparison` (`src/shaders.ts:42-52`; `src/render-pipelines.ts:66-81`).
- **Separate band files:** `MultiCOGLayer`'s `composite` puts up to 4 named bands into RGBA, and a band-math module in `renderPipeline` can then read them. Inferred from the API: no example computes NDVI this way. Sentinel-2 only remaps bands, as in `{ r: "swir2", g: "swir1", b: "blue" }` (see 5.1).
- **Zarr:** entirely the app's code. For example, AEF uploads 64 int8 bands as a texture array and picks 3 in the shader (see 5.1).

### 2.7 Issues seen in the module and pipeline code (from reading only; not run)

1. `cieLabToRGB` passes `color`, a `vec4`, to `cielabToRgb(vec3 labTex)` (`color/cielab.ts:10, 57`). GLSL ES has no implicit `vec4`-to-`vec3` conversion, so the module looks like it wouldn't compile. The default pipeline never reaches it anyway: 3-band images return early (`render-pipeline.ts:307-310`).
2. `CMYKToRGB` is likewise never reached for 4-band CMYK files, which return early as RGBA (`render-pipeline.ts:307-310` vs `:356-360`).
3. A 4-band image whose photometric isn't RGB, such as MinIsBlack, keeps band 4 as alpha: `alphaModule` handles only RGB with 4 bands and gray with 2 (`render-pipeline.ts:271-294`).
4. `FilterNoDataVal` tests only `color.r` (`filter-nodata.ts:31`). In an RGB image, any pixel whose red value equals nodata is discarded, whatever its G and B.
5. `COGLayer`'s default sampler is linear (`render-pipeline.ts:166-175`), and it has no `resampling` prop. The mechanism documented on `MultiCOGLayer` ("linear blending mixes the nodata value into the pixels around it ... drawn as a rim", `multi-cog-layer.ts:180-183`) should therefore affect nodata edges in `COGLayer` too.
6. `MultiCOGLayer` throws `"Band-separate layout not yet supported in MultiCOGLayer"` (`multi-cog-layer.ts:825-827`). LERC always decodes band-separate (`packages/geotiff/src/codecs/lerc.ts:54`), as does PlanarConfiguration=2, and `fetchTile` passes the layout through (`packages/geotiff/src/fetch.ts:140-149, 287-298`). LERC-compressed or planar-separate band files look unusable in `MultiCOGLayer`.
7. `MultiCOGLayer` doesn't check that each file is single-band, but it uploads single-channel formats (`multi-cog-layer.ts:833-846`).
8. The default pipeline has a TODO for a mask that failed to load (`render-pipeline.ts:148`).

---

## 3. Data and format support

### 3.1 `packages/geotiff` (`@developmentseed/geotiff`, 0.10.0-beta.4)

#### Foundation and dependencies
- It wraps `@cogeotiff/core` (`Tiff`, `TiffImage`) for TIFF/IFD parsing (packages/geotiff/src/geotiff.ts:70-84). geotiff.js is only a devDependency, for tests (packages/geotiff/package.json:46). The reasons for leaving geotiff.js are listed in packages/geotiff/README.md:270-284.
- Runtime deps: `@cogeotiff/core` ^9.5.0, `@chunkd/source`, `@chunkd/source-memory`, `@developmentseed/lzw-tiff-decoder`, `fzstd`, `lerc`, `uuid`, plus the workspace packages affine, proj, range-reader and morecantile (packages/geotiff/package.json:53-65).
- BigTIFF is handled by cogeotiff (it has a `TiffVersion.BigTiff` branch: node_modules/.pnpm/@cogeotiff+core@9.5.0/.../build/tiff.js:91).
- The API intentionally mirrors the Python `async-geotiff` (packages/geotiff/src/geotiff.ts:76-78; README:216-222).

#### Public entry points (packages/geotiff/src/index.ts:1-38)
- `GeoTIFF.fromUrl(url, {reader, requestInit, signal, debug, concurrencyLimiter, getPriority})` (geotiff.ts:336-368, options at geotiff.ts:37-68). Header reads and tile reads use two `ByteSource`s over one `RangeReader`, with purpose `"metadata"` vs `"data"`, so "tile churn never evicts the header" (geotiff.ts:350-361).
  - Without a `reader`, `fromUrl` makes a private `RangeReader` with 8 MiB metadata + 8 MiB data cache budgets (geotiff.ts:339-341).
  - `fromUrl` has no concurrency limiter by default; the deck.gl layers pass a shared one (geotiff.ts:55-61).
  - A string URL goes through `new URL(url)` with no base (geotiff.ts:349), so it must be absolute.
- `GeoTIFF.fromArrayBuffer(buf)` wraps the buffer in a chunkd `SourceMemory` (geotiff.ts:321-327).
- `GeoTIFF.open({dataSource, headerSource, signal, debug})` takes any chunkd `Source` (geotiff.ts:175-200), for example a local file (README:189-210).
- `GeoTIFF.fromTiff(tiff, dataSource)` (geotiff.ts:212-308).
- Instance API:
  - getters: `crs`, `width`, `height`, `tileCount`, `tileWidth`, `tileHeight`, `nodata`, `isTiled`, `storedStats`, `offsets`, `scales`, `count`, `colorInterp`, `bbox`, `transform` (geotiff.ts:372-498)
  - `fetchTile(x, y, {boundless, pool, signal})` (geotiff.ts:511-525)
  - `fetchTiles(xy[], ...)` (geotiff.ts:539-552)
  - `read({window, pool, signal})` (geotiff.ts:567-571)
  - `index(x, y)` and `xy(row, col)` (geotiff.ts:584-606)
  - `overviews: Overview[]`; `Overview` has the same fetch, read and transform API (packages/geotiff/src/overview.ts:24-236).
- Other exports:
  - `assembleTiles`, `toPixelInterleaved`, `parseColormap`, `ColorInterp`
  - `DECODER_REGISTRY`, `DecoderPool`, `defaultDecoderPool`, `WindowError`
  - re-exports of `PerOriginSemaphore` and the limiter types (index.ts:1-38)
- `generateTileMatrixSet` exists (packages/geotiff/src/tile-matrix-set.ts:90-176) but is NOT exported from index.ts; only tests use it.
  - The COG layers build an `AffineTileset` instead (packages/deck.gl-geotiff/src/geotiff-tileset.ts:8-58). Its comment: "Replaces the previous `generateTileMatrixSet` + `TileMatrixSetAdaptor`... works correctly for COGs with rotated, skewed, or non-square-pixel geotransforms" (geotiff-tileset.ts:14-17).
  - `generateTileMatrixSet` itself throws on rotated or skewed transforms (tile-matrix-set.ts:141-146) and on non-tiled files (tile-matrix-set.ts:98-100).

#### Compression codecs (`DECODER_REGISTRY`, packages/geotiff/src/decode.ts:62-94)

| Compression (TIFF code) | Decoder | How |
| --- | --- | --- |
| None (1) | passthrough | decode.ts:58-60, 70-72 |
| Deflate (8, 32946) | native `DecompressionStream("deflate")` | codecs/deflate.ts:3-5; codecs/decompression-stream.ts:10-26 |
| LZW (5) | `@developmentseed/lzw-tiff-decoder` (WASM, "WASM LZW decoder for TIFF images"), lazy `import()` | decode.ts:77-79; codecs/lzw.ts:1-13 |
| ZSTD (50000) | `fzstd` (pure JS), lazy | decode.ts:80-82; codecs/zstd.ts:1-6 |
| JPEG (7), old JPEG (6), WebP (50001) | browser `createImageBitmap` + `OffscreenCanvas` `getImageData` | decode.ts:89-91; codecs/canvas.ts:8-52 |
| LERC (34887), incl. LERC+Deflate and LERC+ZSTD | Esri `lerc` WASM (`lerc.load()` once), lazy | decode.ts:92-94; codecs/lerc.ts:6-55 |

- LZMA (34925) and JPEG2000 (34712) are commented-out stubs (decode.ts:83-88). Any other code throws `Unsupported compression: ${compression}` (decode.ts:104-107).
  - That includes PackBits (32773), JPEG-XL (50002) and CCITT. The full enum is in cogeotiff's const/tiff.tag.id.js:66-98.
- The README list matches: "Deflate, LERC, LERC+Deflate, LERC+ZSTD, LZW, JPEG (browser-only), WebP (browser-only), ZSTD" (README:10-12).
- Codecs load lazily, so a codec's bundle size is paid only when used (README:166-172).
- User-defined decoders: `DECODER_REGISTRY.set(Compression.X, () => import(...).then(m => m.decode))` (README:174-187).
  - A decoder returns either raw bytes (`ArrayBuffer`) or decoded pixels (decode.ts:48-56).
  - For workers, override inside a custom worker file that mutates the registry and then imports `@developmentseed/geotiff/pool/worker` (packages/geotiff/src/pool/worker.ts:7-20; package.json exports at packages/geotiff/package.json:13-16).
- JPEG specifics:
  - Shared `JpegTables` (tag 347) are prefetched per IFD and prepended to each tile (fetch.ts:483-488, 629-635, 639-667; ifd.ts:32-38, 166-175).
  - The canvas path supports only samplesPerPixel 1, 3 or 4 (canvas.ts:24-51). It is 8-bit only, since it reads `ImageData`.
  - YCbCr-to-RGB is done by the browser decoder, so the GPU pipeline skips it (packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts:361-365).
  - TODO [#228]: return `ImageBitmap` directly to avoid a GPU-to-CPU copy (canvas.ts:3-7).
- LERC specifics:
  - It returns `layout: "band-separate"` (`result.pixels`) (lerc.ts:54).
  - For F32/F64, pixels invalid in the LERC mask (per-band mask preferred) become NaN, as libtiff does (lerc.ts:51-53, 57-85).
- Predictors:
  - Predictor 2 (horizontal) works for 8, 16 and 32-bit samples; other widths throw (codecs/predictor.ts:87-105).
  - Predictor 3 (floating point) is supported (predictor.ts:106-113).
  - Both apply only to the raw-bytes codecs (decode.ts:112-153).
- Big-endian (`MM`) files: samples wider than 8 bits are byte-swapped before the predictor, except for predictor 3, whose byte planes are always MSB-first (decode.ts:122-139). LERC output is swapped too (decode.ts:155-169).

#### Sample formats and bit depths (raw-bytes path: `toTypedArray`, decode.ts:219-267)
- Uint: 1-bit (unpacked MSB-first to 0/255 `Uint8Array`, decode.ts:201-217, 232-236), 8, 16, 32
- Int: 8, 16, 32
- Float: 32, 64
- Anything else throws `Unsupported sample format/depth`. That includes Uint 2/4/12/24, Int64, Float16 and the complex types (decode.ts:264-266).
- The 1-bit unpack ignores the `FillOrder` tag (TODO at decode.ts:205-206).
- Mixed `SampleFormat` or mixed `BitsPerSample` across bands throws (fetch.ts:911-935).
- `SampleFormat` defaults to Uint when absent, per the spec (ifd.ts:150-152).
- Return type is `RasterTypedArray` = Int8 | Uint8 | Uint8Clamped | Int16 | Uint16 | Int32 | Uint32 | Float32 | Float64 (packages/geotiff/src/array.ts:9-19).

#### Tiled vs stripped, sparse tiles, edge tiles
- Tiled files only: tile reads throw `Tiff is not tiled` for strip layouts (fetch.ts:509-511, 776-779).
- Sparse tiles (offset or byteCount 0): the low-level `getTiles` and `getMultipleBytes` yield `null` (fetch.ts:669-675, 752-758). But `fetchTile` and `fetchTiles` throw `Tile at (x, y) not found` (fetch.ts:330-332, 394-397, 420-424).
- `boundless` defaults to `true`: edge tiles come back at full nominal tile size, with zero padding as stored. `boundless: false` copies out only the valid sub-rectangle (fetch.ts:63, 151-155, 812-880).
- TODO: "support GhostOptionTileOrder" (fetch.ts:513, 781).
- cogeotiff's GDAL ghost-header "leader bytes" path is deliberately disabled (`tiff.options = undefined`), so tile ranges always come from the TileOffsets and TileByteCounts tables (geotiff.ts:188-198; TODO cogeotiff#1467).

#### Band layout (pixel- vs band-interleaved)
- Two result layouts (decode.ts:8-32; array.ts:58-66):
  - `layout: "pixel-interleaved"` with `data` (length w*h*count)
  - `layout: "band-separate"` with `bands[]` (each length w*h)
- PlanarConfiguration=1 (Contig): one fetch per tile, one decode, pixel-interleaved result (except LERC, which is band-separate) (fetch.ts:323-334, 299-304).
- PlanarConfiguration=2 (Separate):
  - One byte range per band per tile, at index `band * tilesPerBand + y * tilesPerRow + x`, each decoded with `samplesPerPixel: 1`.
  - The result is `layout: "band-separate"` (fetch.ts:335-339, 347-392, 287-298).
  - Batched fetches put every band of every tile into one merged read call (fetch.ts:440-481).
- Data is returned in its stored layout. "Image fetching APIs always return data in their original layout, ensuring data copies only happen with the user's explicit consent" (README:41-43).
  - `toPixelInterleaved(array, order?)` is exported (array.ts:110-151; index.ts:13).
  - `toBandSeparate`, `reorderBands` and `packBandsToRGBA` exist but are internal (array.ts:79-204).
- PlanarConfiguration defaults to Contig when absent (ifd.ts:146-148). Any other value throws (fetch.ts:340-343).

#### Overviews
- IFD 0 is the full-resolution image. Every other IFD is classified as data or mask and keyed by `"width,height"` (geotiff.ts:230-245).
- Data IFDs become `Overview`s sorted by pixel count, finest first (geotiff.ts:251-258, 290-305).
- Each overview pairs with the mask IFD of the same size (geotiff.ts:291).
- Overview transform = full-res transform composed with `scale(fullWidth/ovWidth, fullHeight/ovHeight)` (overview.ts:114-122).
- Overviews reuse the primary image's cached tags: bits, sample format, predictor, planar config and LERC parameters (fetch.ts:103-109; overview.ts:25-29). Only compression (read per image: fetch.ts:629, 738) and the JPEG tables are per IFD.
- Selection: the deck.gl COG path turns overviews plus the full image into `AffineTilesetLevel`s, coarsest first (packages/deck.gl-geotiff/src/geotiff-tileset.ts:32-49). Level choice is made by the tile traversal, which the other researcher covers.

#### Masks
- A mask IFD has the SubFileType mask bit (4) AND Photometric = Mask (4) (geotiff.ts:609-624).
- The primary mask is the mask IFD the size of IFD 0 (geotiff.ts:247-249).
- Only masks inside the same file count; there is no `.msk` sidecar lookup (classification walks `tiff.images` only, geotiff.ts:218-245).
- Mask tiles are fetched in parallel with data tiles (fetch.ts:74-84, 194-207) and decoded through the same pool. They must decode to `Uint8Array` (1-bit masks are unpacked to 0/255), else they throw (fetch.ts:229-271).
- Exposed as `RasterArray.mask` (length w*h, non-zero = valid, `null` without a mask IFD) (array.ts:32-36).
- When `read()` stitches tiles, a tile without a mask is filled with 255 (packages/geotiff/src/assemble.ts:63-80).
- Alpha bands: ExtraSamples associated or unassociated alpha becomes `ColorInterp.ALPHA` (colorinterp.ts:74-93; ifd.ts:20-24).

#### Nodata
- The `GDAL_NODATA` tag (42113) is prefetched and parsed with `Number(...)` into `cachedPrimaryImageTags.nodata` (ifd.ts:96, 144).
- The `GeoTIFF.nodata` getter returns cogeotiff's `image.noData` (geotiff.ts:412-415).
- There is one value for all bands, inherited by overviews (overview.ts:89-92).
- It is carried on every `RasterArray.nodata` (array.ts:54-55; fetch.ts:148).
- The default COG render pipeline uses it only for unsigned-int data, scaled to 0-1 (`nodata / (2^bits - 1)`) for `FilterNoDataVal` (packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts:133-142). See 2.3.

#### Colormap / palette
- TIFF `ColorMap` (tag 320) is prefetched as `Uint16Array` (ifd.ts:94, 129).
- `parseColormap(cmap, nodata?)`:
  - converts the 3xN 16-bit tables into an Nx1 RGBA `ImageData`, using `>> 8`
  - makes the optional nodata index transparent
  - has a TODO about 2^16-entry (16-bit) palettes (colormap.ts:9-35)
- `PhotometricInterpretation = Palette` gives `ColorInterp.PALETTE` (colorinterp.ts:53-54). The default pipeline uploads the colormap as an `rgba8unorm` texture with nearest sampling (render-pipeline.ts:164-175, 325-353).

#### GDAL metadata (`GDAL_METADATA` XML, tag 42112)
- Parsed with `DOMParser`, so it needs a browser or DOM (packages/geotiff/src/gdal-metadata.ts:24-30). It throws if the root isn't `<GDALMetadata>`.
- Only per-band `<Item sample=...>` entries are read (dataset-level items are skipped: gdal-metadata.ts:55-57):
  - `STATISTICS_MAXIMUM`, `_MEAN`, `_MINIMUM`, `_STDDEV`, `_VALID_PERCENT`
  - `OFFSET`, `SCALE` (gdal-metadata.ts:59-81)
- Not parsed: band `DESCRIPTION`, units, nodata per band, or other items.
- Exposed as:
  - `geotiff.storedStats`: `Map` keyed by 1-based band (geotiff.ts:422-433)
  - `geotiff.offsets` (default 0) and `geotiff.scales` (default 1), 0-based (geotiff.ts:435-451)
- Not applied anywhere by the layers: there are no uses of `.scales`, `.offsets`, `storedStats` or `gdalMetadata` in packages/deck.gl-geotiff/src or packages/deck.gl-raster/src. A grep found only `colorInterp` uses, at render-pipeline.ts:277, 286.

#### Photometric interpretation / color spaces (decode side)
- `inferColorInterpretation` (colorinterp.ts:22-72):
  - MinIsWhite / MinIsBlack: GRAY plus trailing bands (alpha or undefined)
  - RGB (needs >=3 bands, else throws)
  - Palette
  - Separated: CYAN, MAGENTA, YELLOW, BLACK
  - YCbCr: Y, Cb, Cr
  - anything else (e.g. CIELab) throws `Color interpretation not implemented`
- GPU conversion of these: see 2.3 and 2.7. `photometricInterpretationToRGB` returns `null` for any 3- or 4-band image before checking the photometric (render-pipeline.ts:307-310). So a 4-band CMYK (Separated) or 3-band CIELab file appears to be drawn without the `CMYKToRGB` / `cieLabToRGB` modules (render-pipeline.ts:356-369). This is an observation from reading the code; it was not tested.

#### Decode worker pool
- `DecoderPool({size, createWorker})` (packages/geotiff/src/pool/pool.ts:7-112):
  - `size` defaults to `navigator.hardwareConcurrency`, or 2 (pool.ts:30-31).
  - Without `createWorker`, or with `size` 0, it decodes on the main thread (pool.ts:15-27, 46-55, 81-83).
- `defaultDecoderPool()` is a lazy module singleton: `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })` (pool.ts:114-147). Lazy creation keeps the worker URL out of static init, for IIFE/UMD bundlers (pool.ts:126-129).
- Scheduling: each job goes to the least-loaded worker (pool.ts:103-111). Compressed bytes are transferred zero-copy, and decoded typed-array buffers are transferred back (pool.ts:62-93; pool/wrapper.ts:26-32; pool/worker.ts:31-43).
- Failure: a worker `error` (failed load, or an uncaught throw) rejects its pending jobs. The worker is terminated and gets no new jobs (`jobCount = Infinity`). Once all workers have failed, `decode` rejects (wrapper.ts:56-100; pool.ts:72-74).
- `pool.destroy()` terminates the workers (pool.ts:95-101).
- Without a pool, `GeoTIFF.fetchTile` decodes on the main thread (geotiff.ts:508; README:149).
- The deck.gl layers default to the shared pool. `COGLayer` has a `pool` prop, defaulting to `defaultDecoderPool()` (packages/deck.gl-geotiff/src/cog-layer.ts:94-98, 205). `MultiCOGLayer` does the same (multi-cog-layer.ts:124, 287).
- Bundler requirement: Vite needs `worker: { format: "es" }`, because the worker uses top-level await and dynamic imports; `vite build` fails without it ("Top-level await is currently not supported with the 'iife' output format"). `vite dev` works without it (packages/geotiff/README.md:153-164; packages/deck.gl-geotiff/README.md:39-52). All COG and Zarr examples set it, e.g. examples/cog-basic/vite.config.ts:77 and examples/naip-mosaic/vite.config.ts:7.
- Zarr has no worker pool. There is no `Worker` or `DecoderPool` in packages/deck.gl-zarr/src, geozarr/src or deck.gl-raster/src, so zarrita decodes wherever the user's `getTileData` runs (the main thread).

#### Fetching bytes
- `ByteSource` adapts a `RangeReader` to chunkd's `Source.fetch` (packages/geotiff/src/byte-source.ts:27-106):
  - A negative offset means a suffix read; offset 0 with no length reads the whole object; open-ended reads throw (byte-source.ts:67-85).
  - `head()` is unsupported (byte-source.ts:62-65).
  - A `not-found` result throws `<url> not found` (byte-source.ts:92-94).
  - The first response's ETag or Last-Modified is remembered; a later different validator throws `ETag conflict` (byte-source.ts:35-37, 95-103).
- Header prefetch: cogeotiff's first read is `Tiff.DefaultReadSize` = 16 KiB (node_modules/.pnpm/@cogeotiff+core@9.5.0/.../build/tiff.js:12). The range reader widens metadata reads shorter than 64 KiB to aligned 64 KiB blocks (see 3.2) (geotiff.ts:182-187).
- Tag prefetch at open, for the primary image (ifd.ts:64-155):
  - BitsPerSample, ColorMap, ExtraSamples
  - GDAL_NODATA, GDAL_METADATA
  - LercParameters
  - ModelPixelScale, ModelTiePoint, ModelTransformation
  - Photometric, PlanarConfiguration, Predictor
  - SampleFormat, SamplesPerPixel
  - JpegTables (per image: ifd.ts:166-175)
- Tile offsets and byte counts are read lazily, entry by entry, through the header source. A caller's `AbortSignal` is not forwarded into that shared lookup: aborting ends the caller's wait while the shared read continues ([#690]) (fetch.ts:541-588).
- Batching: `fetchTiles(xy)` resolves every tile's range first and issues all reads together, so the range reader can merge them. Decoding is still per tile (fetch.ts:158-217; getMultipleBytes at fetch.ts:669-750).
- Window reads: `read({window})` fetches every tile the window touches (`boundless: false`), stitches them with `assembleTiles`, and crops (packages/geotiff/src/read.ts:45-87). Windows must be integer and inside the image, else it throws `WindowError` (read.ts:89-124; window.ts:1-24).
- `debug: true` logs each data or mask fetch with its offset and length (geotiff.ts:52-54; fetch.ts:614-618).

#### Georeferencing (transform)
- From ModelTiepoint + ModelPixelScale. Only the first tiepoint's x and y are used (`modelTiepoint[3]`, `[4]`), assuming pixel (0,0) (packages/geotiff/src/transform.ts:36-46).
- Otherwise from the 4x4 ModelTransformation (rotation and skew supported) (transform.ts:48-62).
- With neither, it throws `The image does not have an affine transformation.` So GCP-only rasters are unsupported (transform.ts:16-26).
- PixelIsPoint (`GTRasterTypeGeoKey`) shifts by half a pixel with `pixelIsPointToArea` (transform.ts:28-31).
- `bbox` is the box around all four corners, so it holds for rotated or skewed transforms (geotiff.ts:467-484).

#### CRS from GeoKeys (packages/geotiff/src/crs.ts)
- Output type `number | ProjJson | string` (crs.ts:77-108; doc at geotiff.ts:372-385):
  - Model type 1 (projected): `ProjectedCRSGeoKey` EPSG code as a number, or a PROJJSON `ProjectedCRS` built from keys when user-defined (32767) (crs.ts:137-143, 189-204).
  - Model type 2 (geographic): `GeodeticCRSGeoKey` EPSG code, or a PROJJSON `GeographicCRS` (crs.ts:129-135, 145-187).
  - Model type 32767 with an `ESRI PE String = ...` ProjectedCitation: the raw ESRI WKT string (crs.ts:98-103, 110-127).
  - Anything else throws `Unsupported GeoTIFF CRS definition with model type` (crs.ts:105-107).
- EPSG codes are returned as numbers, "letting the caller decide how to resolve it" (crs.ts:80-81; README:126-136). The PROJJSON is built natively, "without a large cache of PROJ data", avoiding the ~1.5 MB `geotiff-geokeys-to-proj4` (README:132-134).
- User-defined projection methods (`ProjMethodGeoKey`) handled (crs.ts:22-49, 301-605):
  - Transverse Mercator, plus codes 2 and 27 mapped to "Transverse Mercator (South Orientated)"
  - Oblique Mercator (codes 3-6, all mapped to "Hotine Oblique Mercator (variant B)")
  - Mercator (variant A)
  - LCC 1SP and 2SP
  - Lambert Azimuthal Equal Area
  - Albers
  - Azimuthal Equidistant (as "Modified Azimuthal Equidistant")
  - Stereographic, Polar Stereographic (variant B), Oblique Stereographic
  - Equirectangular (as "Equidistant Cylindrical")
  - Cassini-Soldner, Orthographic, Polyconic, Sinusoidal
  - New Zealand Map Grid
  - Cylindrical Equal Area (libgeotiff extension code 28)
  - Other codes throw `Unsupported coordinate transformation type`. No case exists for codes 13, 19, 20, 23 and 25 (Equidistant Conic, Gnomonic, Miller, Robinson and VanDerGrinten, per the GeoTIFF spec) (crs.ts:606-607).
- Parameter keys: the first present of several equivalent keys is used, as libgeotiff does (crs.ts:254-269).
- Gaps visible in the code:
  - An EPSG-coded datum under a user-defined CRS becomes a name-only datum, with no ellipsoid or prime meridian (crs.ts:161-165).
  - `toWGS84`, the vertical keys and the custom unit sizes are extracted (ifd.ts:186-267) but unused by the builder.
  - Linear units map only metre, foot and US survey foot; unknown codes fall back to `"metre"` silently (crs.ts:61-75, 633-635).
  - Angular units map degree, radian and grad, with a fallback to degree (crs.ts:51-59, 611-613).
  - Conversion parameters are always labelled degree, metre or unity (crs.ts:271-299).

---

### 3.2 `packages/range-reader` (`@developmentseed/range-reader`)

- Purpose: "Streamed, coalesced HTTP byte-range reads with a budgeted byte cache" (packages/range-reader/README.md:1-13). It exists because of HTTP/1.1's 6 connections per host on S3 and Azure, and per-request latency and price (README:15-23).

#### Options and defaults (types at packages/range-reader/src/types.ts:134-154; README table at README.md:62-72)

| Option | Default | Where |
| --- | --- | --- |
| `fetch` | `globalThis.fetch` | reader.ts:111 |
| `cache` | `MemoryByteCache`, **32 MiB metadata + 64 MiB data** | memory-cache.ts:9-13, 49-54; reader.ts:112-115 |
| `maxGap` | `"median"` (the batch's median read length) | reader.ts:116; merge.ts:44-45, 101-105 |
| `maxOverfetchBytes` | 1 MiB | reader.ts:24-25 |
| `maxRequestBytes` | 1 MiB (also the largest whole object accepted when a server ignores `Range`) | reader.ts:27-32; stream.ts:48-50, 247-264 |
| `minMetadataReadBytes` | 64 KiB | reader.ts:34-35 |
| `cacheMode` | browser default (`RequestInit.cache`) | reader.ts:122; stream.ts:194-197 |

#### Coalescing
- The batching window is one task: queued reads flush on `setTimeout(..., 0)` (reader.ts:251-289).
- Reads merge only within one file identity and purpose (reader.ts:441-444). File identity = URL + headers, credentials and mode (packages/range-reader/src/identity.ts:9-43).
- `mergeReads` (packages/range-reader/src/merge.ts:28-84):
  - Reads are sorted by offset, longest first.
  - An overlapping read always joins the current range.
  - An adjacent or gapped read joins only if the gap is <= `maxGap`, the merged length is <= `maxRequestBytes`, and the total overfetch is <= `maxOverfetchBytes`.
- Metadata reads shorter than `minMetadataReadBytes` are widened to aligned blocks and kept to the block's end for the cache (merge.ts:86-99; reader.ts:263-269, 340-351).
- Launch order is round-robin across files and purposes, so multi-file tiles aren't starved (reader.ts:291-330).
- A read inside an in-flight stream attaches to it instead of starting a new request (reader.ts:174-187).

#### Streaming and abort
- Each read resolves the moment its last byte arrives (README:8-10; stream.ts:55-61).
- Abort: a read whose signal aborts rejects immediately. The request continues while other reads want it, and is cancelled, keeping the bytes that arrived, when the last one leaves (README:58-60; reader.ts:126-153).
- Queued reads are spliced out on abort (reader.ts:273-284). The limiter rejects queued waiters on abort without using a slot (packages/range-reader/src/limiter.ts:73-75, 93-119).

#### Cache
- LRU by purpose tier. Containment lookup: any stored span that fully contains a read serves it, whichever purpose fetched it (memory-cache.ts:34-80).
- A span over its tier's budget is not stored. A partial overlap is a miss (memory-cache.ts:34-43, 82-133).
- Pluggable `ByteCache` interface (`get`, `put`, optional `byteSize` and `delete`), e.g. for OPFS or Cache Storage (README:84-101; types.ts:87).
- Validator handling: a changed ETag or Last-Modified purges the file's cached spans and counts in `stats.validatorChanges` (reader.ts:98-105, 395-414; README:103-114). The reader never sends `If-Match`, to avoid CORS preflights (README:112-114).

#### HTTP status handling
- 404 resolves as `not-found` (stream.ts:231-238). Any other status besides 200 or 206 fails (stream.ts:239-241).
- A 200 for a range request is accepted only when the whole object is <= `maxRequestBytes`, else it fails (stream.ts:247-264).

#### Concurrency
- `Semaphore` with dynamic priority: `getPriority` is re-evaluated on every slot-open, lower is served first, ties are FIFO (limiter.ts:1-163).
- `PerOriginSemaphore`: one semaphore per `url.origin` (limiter.ts:190-221).
- The limiter slot is held from before the request until the stream ends (stream.ts:46-47, 161-180).
- `reader.stats`: requests, cancelled, bytes requested, received and overfetched, cache hits and hit bytes, attached, validatorChanges (reader.ts:69-80).

#### Wiring in deck.gl-raster
- `DEFAULT_RANGE_READER = new RangeReader()`: one page-wide reader with default budgets (packages/deck.gl-raster/src/default-range-reader.ts:1-7; exported at deck.gl-raster/src/index.ts:1).
- `DEFAULT_CONCURRENCY_LIMITER = new PerOriginSemaphore({ maxRequests: 6 })`, matching Chrome's per-origin HTTP/1.1 limit (packages/deck.gl-geotiff/src/default-concurrency-limiter.ts:3-13).
- `COGSource.open` defaults to both (packages/deck.gl-geotiff/src/cog-source.ts:114-125). So do `MultiCOGSource` (multi-cog-source.ts:144-146) and the `MosaicLayer` defaultProps (mosaic-layer.ts:202-203).
- `COGSourceOptions` (cog-source.ts:35-82):
  - `concurrencyLimiter`: pass `null` to disable, e.g. on HTTP/2 (cog-source.ts:51-62)
  - `requestInit`: headers, credentials, mode; for auth
  - `reader`, `getPriority`, `signal`, `epsgResolver`
- Scope: COG only. Zarr reads go through the caller's zarrita store, and "you control consolidation, range coalescing, and authentication" (packages/deck.gl-zarr/README.md:82). Range-reader status: "Sharded Zarr is next" (range-reader/README.md:116-122).

---

### 3.3 GeoZarr: `packages/geozarr` + `packages/deck.gl-zarr` (source side)

#### Conventions parsed (packages/geozarr/README.md:8; schemas at packages/geozarr/src/schemas.ts)
- The `spatial`, `geo-proj` (`proj:`) and `multiscales` zarr-conventions, validated with Zod (`zod` ^4.6.7: geozarr/package.json:38-41).
- The convention repos are git submodules at "v0.1"-era tags, all "Extension Maturity Classification: Proposal" (packages/geozarr/spatial/README.md:1-8; geo-proj/README.md:1-8; multiscales/README.md:1-8).
- `geo-proj` (schemas.ts:14-25): exactly one of
  - `proj:code`, matching `/^[A-Z]+:[0-9]+$/`
  - `proj:wkt2`
  - `proj:projjson`
- `spatial` (schemas.ts:79-126):
  - `spatial:dimensions` (length exactly 2: [y, x] names)
  - `spatial:transform` (6-element affine)
  - `spatial:shape` ([height, width])
  - `spatial:bbox`, `spatial:transform_type`
  - `spatial:registration`: `"node"` or `"pixel"`
  - A superRefine requires `spatial:transform` at group level or on every layout item when the transform type is affine (the default).
- `multiscales` layout items (schemas.ts:43-65):
  - `asset` (path), `derived_from`, `transform {scale, translation}`, `resampling_method`
  - per-level `spatial:transform` and `spatial:shape`

#### `parseGeoZarrMetadata(attrs)` (packages/geozarr/src/parse.ts:26-119)
- Returns `{levels, crs, registration, axes, yAxisIndex, xAxisIndex}` (packages/geozarr/src/types.ts:30-49).
- Levels use only `asset`, `spatial:transform` (falling back to the group-level transform) and `spatial:shape`. Each level needs a shape and a transform, else it throws (parse.ts:57-83).
- The relative `transform.scale/translation`, `derived_from` and `resampling_method` are validated but not used for geometry. `spatial:bbox` is unused.
- Levels are sorted finest-first by geometric-mean pixel size, whatever the layout order (parse.ts:84-86, 121-124).
- Single resolution: a top-level `spatial:transform` and `spatial:shape` give one level at path `"."` (parse.ts:87-109).
- Non-affine `spatial:transform_type` passes the schema (schemas.ts:104-109), but parse still requires a `spatial:transform` (parse.ts:63-67, 89-94). In effect only affine grids work; there is no rectilinear or curvilinear coordinate-array support.
- `registration` defaults to `"pixel"` (parse.ts:114). `"node"` gets a half-pixel shift with `pixelIsPointToArea` (packages/deck.gl-zarr/src/zarr-tileset.ts:50-53; zarr-source.ts:388-396).

#### `ZarrSource.open(input, {path, geoZarrMetadata, epsgResolver, signal})` (packages/deck.gl-zarr/src/zarr-source.ts:137-255)
- Input: a zarrita store, or an opened group or array (zarr-source.ts:25-32). The caller builds the store, e.g. `zarr.FetchStore`, optionally wrapped in `withConsolidatedMetadata` (zarr-source.ts:155-160).
- Zarr version: tries v3, then falls back to v2 only on NotFound; it never tries v2 first ([#838]) (zarr-source.ts:281-298).
- Metadata override: `geoZarrMetadata` replaces the data's own attrs, "for a store without GeoZarr metadata" (zarr-source.ts:45-51). Examples hand-write attrs this way:
  - examples/dynamical-zarr-ecmwf/src/ecmwf/metadata.ts:1-22 ("The source store is not GeoZarr-compliant, so we inject a synthetic attrs object"), used at dynamical-zarr-ecmwf/src/App.tsx:119-126
  - icechunk via `icechunk-js`: examples/nldas-icechunk/src/nldas/store.ts:1-48
- Inheritance: an array inherits its parent group's `spatial:*` attrs, and its `proj:*` attrs unless the array has its own (zarr-source.ts:141-144, 300-352).
- A group without `multiscales` is rejected; name the array with `path` (zarr-source.ts:182-188).
- Dimensions:
  - All array dims must be named (`dimension_names`); unnamed dims throw (zarr-source.ts:202-227).
  - y must come before x; x-before-y "needs a transpose, which is not implemented" (packages/deck.gl-zarr/src/validation.ts:63-103).
  - Other dims may be anywhere, e.g. `[band, y, x]` or `[y, x, band]` (zarr-source.ts:102-107).
  - All levels must share dim names and dtype (zarr-source.ts:216-217, 408-442).
- Tile grid = chunk grid: tile width and height = `arr.chunks[x]` and `arr.chunks[y]` per level (zarr-source.ts:239-242; zarr-tileset.ts:26-69). For sharded arrays, zarrita's `arr.chunks` is the inner chunk shape (`configuration.chunk_shape` of `sharding_indexed`), so a tile = one inner chunk (node_modules/.pnpm/zarrita@0.7.5/.../dist/src/hierarchy.js:72-86, 131-133).
- CRS resolution (zarr-source.ts:354-382):
  - `proj:code`: only the `EPSG` authority; others throw `Unsupported CRS authority`. The code then goes through `epsgResolver`.
  - `proj:wkt2` and `proj:projjson` go through `parseWkt`.
- Bounds: WGS84 bounds of the finest level's four corners via `geographicBounds` (zarr-source.ts:384-406).

#### Extra (non-spatial) dimensions
- The `ZarrLayer` `selection` prop must have exactly one entry per non-spatial dim (packages/deck.gl-zarr/src/zarr-layer.ts:85-101; validated in validation.ts:15-51). Each entry is:
  - a number (pin one index)
  - `null` (zarrita's default, the full extent)
  - a `zarr.Slice` (a range)
- No silent defaults: missing, spatial or unknown dims throw. A bad selection goes to `onError`, and nothing is drawn (zarr-layer.ts:94-96, 166-196).
- The layer builds `sliceSpec` per tile: spatial dims are sliced to the tile, clipped at array edges, and other dims come from `selection` (zarr-layer.ts:237-277).
- The user's `getTileData(arr, {sliceSpec, width, height, x, y, z, signal, device})` calls `zarr.get(arr, sliceSpec)`. The result comes in the array's own dim order, e.g. `[y, x, band]` (zarr-layer.ts:103-123).

#### Data types and chunk handling
- deck.gl-zarr does not interpret dtypes. "The layer doesn't check the data type of data it opens" (zarr-layer.ts:71-72). Users narrow with `source.is("float32")` (zarr-source.ts:129-135; deck.gl-zarr/README.md:39-54) and convert in `getTileData` / `renderTile` (README:68-75).
- No nodata, fill-value or scale-offset handling in deck.gl-zarr or geozarr: a grep for fill_value, missing_value, scale_factor and add_offset found nothing. Examples read the fill value from attrs themselves (examples/nldas-icechunk/src/nldas/store.ts:55-60).
- Codecs are whatever zarrita 0.7.5 supports (packages/deck.gl-zarr/package.json:54; zarrita dist/src/codecs.js:14-45):
  - v3 names: blosc, lz4, zstd (lazy numcodecs WASM), gzip, zlib, transpose, bytes, crc32c, vlen-utf8, json2, bitround, cast_value, scale_offset
  - `numcodecs.*` v2-compat names, which add shuffle and delta
  - plus `sharding_indexed` (zarrita hierarchy.js:72-86)

---

### 3.4 `packages/morecantile` (`@developmentseed/morecantile`)

- A partial TypeScript port of Python morecantile (packages/morecantile/README.md:9-12). Exports (packages/morecantile/src/index.ts:1-8):
  - types: `BoundingBox`, `CRS`, `TileMatrix`, `TileMatrixSet`
  - `xy_bounds(matrix | tms, tile)`: tile bounds in the TMS CRS, honoring `cornerOfOrigin` (packages/morecantile/src/tile.ts:6-43)
  - `matrixTransform(matrix)`: one affine for the whole matrix, or `null` when `variableMatrixWidths` is present (packages/morecantile/src/transform.ts:4-34)
  - `tileTransform(matrix, {col, row})`: per-tile affine, with variable-matrix-width coalescing stretching x (transform.ts:36-84)
- Types are generated from the OGC TMS 2.0 JSON Schemas (spec submodule at tag 2.0.0). The ~1000-line PROJJSON schema is replaced by an opaque alias (packages/morecantile/scripts/generate-types.ts:1-38; src/types/index.ts:1-4).
- No built-in TMS definitions (e.g. WebMercatorQuad) ship in `src/`. The OGC registry JSON lives only in the spec submodule (packages/morecantile/spec/registry/json/).
- Consumer: `TileMatrixSetAdaptor` in deck.gl-raster (packages/deck.gl-raster/src/raster-tileset/tile-matrix-set.ts:2-3), which is in the other researcher's scope. The COG and Zarr paths use `AffineTileset`, not TMS (geotiff-tileset.ts:8-17; zarr-tileset.ts:12-69).

---

### 3.5 CRS resolution end to end: `packages/proj` + `packages/epsg`

#### `@developmentseed/proj` (deps: `proj4` ^2.22.0, `wkt-parser` pinned 1.6.0: packages/proj/package.json:46-49)
- Exports (packages/proj/src/index.ts:1-31):
  - `parseWkt`, `projectionFunctions`, `epsgResolver`
  - `registerProjection`, `PROJECTION_REGISTRY`
  - `metersPerUnit`, `geographicBounds`, `transformBounds`
  - `normalizeLongitudes`, `splitAtAntimeridian`, `unwrapBbox`
  - `nearestCopy`, `unwrapAlong`, `makeClampedForwardTo3857`
  - the PROJJSON types
- The pipeline for a COG (packages/deck.gl-geotiff/src/projection.ts:7-16; cog-source.ts:128-146):
  1. `geotiff.crs` gives a number, PROJJSON or WKT.
  2. A number goes through `epsgResolver(code)`; PROJJSON or WKT goes through `parseWkt(...)`. Either way the result is a proj4-compatible `ProjectionDefinition`.
  3. `projectionFunctions(def)` builds `projectTo4326` / `projectFrom4326` / `projectTo3857` / `projectFrom3857` and `mpu`.
  4. Those feed the tileset descriptor and the geographic bounds.
- The Zarr path is the same via `resolveCrs` (zarr-source.ts:354-382).
- Default `epsgResolver` (packages/proj/src/registry.ts:35-77):
  - If proj4 ships a definition, it is resolved with no request. The comment lists "4326, 4269, 3857 and the UTM zones" (registry.ts:38, 59-64; README: "4326, 3857 and the WGS 84 UTM zones", packages/proj/README.md:5).
  - Otherwise it **fetches `https://epsg.io/${epsg}.json`** (PROJJSON) and parses it with `wkt-parser` (registry.ts:65-77).
  - Results are cached as promises in `PROJECTION_REGISTRY`, so concurrent callers share one request. A failed request is evicted, so the next caller retries (registry.ts:6-53).
  - So by default there is a runtime dependency on epsg.io for any non-proj4 EPSG code, and no offline EPSG table.
- User hooks:
  - `registerProjection(epsg, wktOrProjjson)` pre-registers a definition that "will never pass through EpsgResolver" (registry.ts:20-33).
  - Or pass a custom `epsgResolver` to `COGSource.open` / `MultiCOGSource.open` / `ZarrSource.open` (cog-source.ts:39-49; zarr-source.ts:53-63).
  - A layer given a URL opens with the defaults only (`COGSource.open(input, { signal })` at cog-layer.ts:140; `ZarrSource.open(input, { signal })` at zarr-layer.ts:210). To change the resolver, open the source yourself (cog-layer.ts:79-81).
  - Example resolvers: proj4 defs registered for UTM NAD83 (examples/naip-mosaic/src/proj.ts:1-21); the offline `@developmentseed/epsg` table (examples/land-cover/src/App.tsx:1-4, 27-41).
- `parseWkt(input: string | ProjJson)` is a typed wrapper of `wkt-parser`. It accepts WKT1, WKT2 and PROJJSON. A `longlat` result with missing or unknown units is patched to degrees (packages/proj/src/parse-wkt.ts:58-75).
- `projectionFunctions` builds proj4 converters to EPSG:4326 and EPSG:3857 (packages/proj/src/projection-functions.ts:13-65).
  - It needs `projection.units`, else it throws (projection-functions.ts:48-53).
  - `mpu` comes from `metersPerUnit`.
- Special cases:
  - `makeClampedForwardTo3857`: when proj4 returns non-finite values, e.g. at the poles, it projects to 4326, clamps latitude to +/-85.0511°, and converts analytically (packages/proj/src/web-mercator.ts:20-55). An identical copy lives in raster-tile-traversal.ts (web-mercator.ts:31-34).
  - `registerCylindricalEqualArea()` registers proj4's `cea` under the names wkt-parser emits ("Lambert_Cylindrical_Equal_Area", "Cylindrical_Equal_Area"), reading `lat1` as `lat_ts`. It is a workaround, [#791] (packages/proj/src/cylindrical-equal-area.ts:4-28). It runs at import of parse-wkt (parse-wkt.ts:5).
- `metersPerUnit(unit, {semiMajorAxis})`:
  - m/metre/meter/meters = 1
  - foot = 0.3048
  - us survey foot = 1200/3937
  - degree(s) = 2*pi*a/360, which needs `a`
  - Anything else throws `Unsupported CRS units` (packages/proj/src/meters-per-unit.ts:1-55).
- Bounds and antimeridian helpers:
  - `geographicBounds(ring, projectTo4326)` unwraps longitudes along the ring edges, so antimeridian crossings come out the short way: `west` is in [-180, 180) and `east` may exceed 180 (packages/proj/src/geographic-bounds.ts:5-55). Stated limits: a ring around a pole is not bounded correctly, and a curved edge between points can exceed the bounds (geographic-bounds.ts:15-20).
  - `transformBounds(project, l, b, r, t, {densifyPts = 21})` (packages/proj/src/transform-bounds.ts:7-67).
  - `normalizeLongitudes`, `splitAtAntimeridian`, `unwrapBbox` (for GeoJSON/STAC-style `minX > maxX`) (packages/proj/src/antimeridian.ts:13-80).
  - `nearestCopy` and `unwrapAlong` (recursive halving, up to 4096 steps) (packages/proj/src/unwrap.ts:6-82).

#### `@developmentseed/epsg` (opt-in offline EPSG database)
- "The full EPSG projection database, compressed to **309kb** for the web": WKT2 definitions for "all 7352 defined EPSG projection codes" (packages/epsg/README.md:3-7). The file is `src/all.csv.gz`, 316,288 bytes on disk.
- API: `loadEPSG(url?) => Promise<Map<number, string>>` (code to OGC WKT2). It is cached after the first call (packages/epsg/src/all.ts:3-27).
  - It fetches the gzipped CSV (`code|wkt` lines) and decompresses with `DecompressionStream("gzip")`, unless the server already sent `Content-Encoding: gzip`, then parses streaming (all.ts:29-97).
  - Package exports are `./all` and `./all.csv.gz` (packages/epsg/package.json:6-12).
  - With Vite, pass `import csvUrl from "@developmentseed/epsg/all.csv.gz?url"` (all.ts:15-17; used at examples/land-cover/src/App.tsx:3-4, 33).
- Not wired into the default `epsgResolver`; a user must write a resolver around it, e.g. `parseWkt(epsgDb.get(code))` (examples/land-cover/src/App.tsx:27-41). Only the land-cover example uses it.
- The definitions are regenerated from the epsg.org WKT download with `scripts/generate.py` (README:41-51).

---

### 3.6 `packages/affine` (`@developmentseed/affine`)

- "A TypeScript port of rasterio/affine" (packages/affine/README.md:1-5).
- `Affine` = readonly `[a, b, c, d, e, f]`, with `x = a*col + b*row + c`, `y = d*col + e*row + f` (packages/affine/src/affine.ts:1-18; index.ts:1-20).
- Functions (affine.ts:29-263):
  - `identity`
  - `fromGDAL([c, a, b, f, d, e])` (GDAL geotransform order; affine.ts:33-52)
  - `translation`, `scale`, `rotation(angle, pivot?)` (exact right angles; affine.ts:94-133)
  - `apply`, `compose(A, B)` (apply B first; affine.ts:167-195)
  - `pixelIsPointToArea` = compose with `translation(-0.5, -0.5)` (affine.ts:197-208)
  - `invert` (throws on a degenerate transform; affine.ts:210-235)
  - component accessors `a`..`f`
- Used everywhere: COG transforms (geotiff/src/transform.ts), GeoZarr levels (geozarr/src/parse.ts:1-2), VRT `GeoTransform` via `fromGDAL` (packages/deck.gl-geotiff/src/mosaic-layer/vrt.ts:113-120).

---

### 3.7 Other format-adjacent pieces (brief; the layers are in section 1)

- **GDAL VRT mosaics**: `parseVRT(xml, vrtUrl)` is exported from deck.gl-geotiff (packages/deck.gl-geotiff/src/index.ts:15-16; README.md:57-77).
  - It reads each source file's `DstRect`, places it with the VRT `GeoTransform` and `SRS`, and returns `{id, url, bbox}` items in VRT order, de-duplicating files listed under several bands (vrt.ts:28-98).
  - `SrcRect`, scaling and other per-source options are ignored. Each file draws with its own georeferencing (vrt.ts:32-34).
  - It throws on warped or derived VRTs (`subClass`) and on source paths that are not http(s), `/vsicurl/` or `relativeToVRT` (vrt.ts:41-43, 53-56, 64-68, 100-111).
  - It uses `DOMParser` (vrt.ts:36, 45).
- **Multi-file scenes** (`MultiCOGSource`): band files must share the CRS (EPSG by number, WKT or PROJJSON by value) and extent, within one pixel of the coarser file. Resolutions may differ (packages/deck.gl-geotiff/src/multi-cog-source.ts:22-86).
- **`RasterSource`** is the abstract base class: `tilesetDescriptor` + `geographicBounds` (WGS84; `east` may exceed 180 across the antimeridian). Subclasses: `COGSource`, `MultiCOGSource`, `ZarrSource` (packages/deck.gl-raster/src/raster-source.ts:1-38).
- **COGLayer default CRS bounds**: `getGeographicBounds` uses the bbox corners through `geographicBounds` (packages/deck.gl-geotiff/src/geotiff/geotiff.ts:114-136).

---

### 3.8 Format-level limitations and TODOs seen in code (summary)

- Compression: no PackBits, LZMA, JPEG2000, JPEG-XL or CCITT (decode.ts:83-88, 104-107). JPEG and WebP need browser `createImageBitmap` + `OffscreenCanvas`, and are 8-bit only with 1, 3 or 4 samples (canvas.ts:8-51; README "browser-only" at README:11).
- Sample formats: no Int64, Float16, sub-byte (except 1-bit) or complex data; no mixed per-band formats or depths (decode.ts:224-267; fetch.ts:911-935).
- Layout: tiled TIFFs only, no strips (fetch.ts:509-511). Sparse tiles throw in `fetchTile` / `fetchTiles` (fetch.ts:330-332, 420-424). No GhostOptionTileOrder (fetch.ts:513, 781). 1-bit unpacking ignores FillOrder (decode.ts:205-206).
- Overviews share the primary's sample format, predictor, planar config and LERC parameters (fetch.ts:103-109).
- Georeferencing: no GCP-only rasters; only the first tiepoint is used (transform.ts:16-46).
- CRS:
  - Some GeoTIFF projection methods are unsupported (crs.ts:606-607).
  - Datum shifts (`toWGS84`) are ignored, and unknown linear units silently become metres (crs.ts:61-75, 633-635).
  - Non-proj4 EPSG codes need network access to epsg.io unless the user supplies a resolver (registry.ts:65-77).
  - GeoZarr `proj:code` must be EPSG (zarr-source.ts:363-368).
  - `metersPerUnit` handles only metre, foot, US survey foot and degree (meters-per-unit.ts:52-54).
- GDAL metadata: only stats, scale and offset are parsed; scale and offset are not applied by the layers (gdal-metadata.ts:59-81). Band descriptions are not parsed.
- Palette: 16-bit palettes untested (colormap.ts:10).
- GeoZarr:
  - affine transforms only (parse.ts:63-67, 89-94)
  - dims must be named and y must precede x (validation.ts:95-101; zarr-source.ts:205-227)
  - no automatic fill-value or nodata handling
  - no built-in range coalescing or caching for Zarr
  - no decode workers
- Photometric observation (see 2.7): CMYK and CIELab conversion modules look unreachable for 4- and 3-band images (render-pipeline.ts:307-310 vs 356-369).

---

## 4. Views and integration

### 4.1 Which deck.gl views work

- **`MapView` / Web Mercator: the main path.**
  - `RasterTileLayer` draws each tile's mesh in deck.gl's Web Mercator common space, with `coordinateSystem: "cartesian"`. The positions come from the tile's `_projectPosition`, which maps the source CRS to common space (`raster-tile-layer.ts:790-810`).
  - Positions are fp64-emulated for precision at high zoom (`mesh-layer/mesh-layer-vertex.glsl.ts:6-12, 81`; `raster-layer.ts:451-453`).
  - Tiles beyond +/-85.051° are cut to Web Mercator's latitude band by a seed triangulation, for grids whose rows are lines of constant latitude (`raster-tile-layer.ts:823-827`; `raster-tileset/web-mercator-clamp.ts:4-30`).
- **`GlobeView`: preliminary.**
  - Detected by `viewport.resolution !== undefined` (`raster-tile-layer.ts:776`; `raster-layer.ts:246`). The mesh is then in lng/lat (`coordinateSystem: "lnglat"`), projected with the source's `projectTo4326` (`raster-tile-layer.ts:781-789`).
  - Instead of the adaptive mesh, each tile gets a uniform 32x32-cell grid (about 1089 vertices). The code calls it a "TEMPORARY GLOBE VIEW HACK" and "THROWAWAY", because "Delatin's reprojection-error metric is blind to sphere curvature and facets at low zoom" (`raster-layer.ts:239-262`; `globe-grid-mesh.ts:4-22`).
  - `zRange` is ignored on the globe (`raster-tile-layer.ts:170`).
  - The blog says "Preliminary GlobeView support ... some projections may render with some distortion" (see 7.2).
  - Examples get a globe from MapLibre's `projection="globe"` through the interleaved overlay. They set `parameters: { depthCompare: "always" }` against z-fighting with the basemap sphere; the far side stays hidden because deck.gl's `GlobeView` culls back faces (deck.gl 9.4 and later) (`examples/cog-globe/src/App.tsx:115-121`). No tracked example builds a deck.gl `GlobeView` directly (see 5.4).
- **`OrbitView`, `OrthographicView`, `FirstPersonView`: no supported path in the library.**
  - `RasterTileLayer` has two branches: globe, and otherwise Web Mercator common space (`raster-tile-layer.ts:776-810`). Tile selection converts bounds with `lngLatToWorld` (`raster-tileset/raster-tile-traversal.ts:1030-1038`).
  - Inferred: in a non-geographic view, tiles would be placed in Web Mercator common-space units, and their selection would assume a Web Mercator viewport.
- **Custom projections (polar stereographic, Equal Earth, and so on): an experimental example only, waiting on deck.gl v10.**
  - `examples/experimental/custom-projection` adds a `CustomProjectionView` shim built on `OrthographicView`, standing in for deck.gl's unreleased `_CustomProjectionView`. It also adds a `ProjectedCOGLayer extends COGLayer`, with its own `CustomProjectionTileset2D` and one `cartesian` `RasterLayer` per tile.
  - The layer "lives in the example rather than in deck.gl-raster while upstream's API settles. Folding it into the library would mean a third traversal mode in `RasterTileset2D` and a third branch in `RasterTileLayer`" (`examples/experimental/custom-projection/src/projected-cog-layer/projected-cog-layer.ts:58-81`; README `:8-14`). There is no basemap: MapLibre can't draw custom projections.
  - Its limitations are in 7.2, and its code in 5.4.

### 4.2 Terrain draping (`zRange`)

- `zRange: [minMeters, maxMeters]` widens tile selection to the volume between those heights, "so tiles the terrain lifts into view still load". It "only changes which tiles load; it doesn't move the raster" (`raster-tile-layer.ts:162-179`). Inside the traversal it becomes the elevation bounds (`raster-tile-traversal.ts:999-1002`).
- Draping itself is deck.gl's experimental `_TerrainExtension`, with `terrainDrawMode: "drape"`:
  - The example notes that `terrainDrawMode: "drape"` is required: "Left unset, the extension picks `offset` for deck.gl-raster's mesh layer, which lifts only the reprojection mesh's few vertices onto the terrain, so ridges cut through the image" (`examples/experimental/cog-terrain/src/App.tsx:394-418`).
  - The `TerrainLayer` needs `operation: "terrain+draw"` (`App.tsx:385-387`).
  - The example widens `zRange` from each terrain tile's `header.boundingBox` as tiles load (`raster-tile-layer.ts:172-175`).
- The raster mesh itself is flat at `z = 0` (`raster-layer.ts:447-448`). There is no built-in DEM-to-3D-surface layer, and no hillshade module; `pmtiles-terrain` computes hillshade in its own shader (see 5.1).

### 4.3 MapLibre / Mapbox interleaving

- Integration goes through deck.gl's `MapboxOverlay` from `@deck.gl/mapbox`, in `interleaved` mode, with `beforeId` to slot a layer into the style. `beforeId` isn't in deck.gl's `LayerProps`, so it needs `@ts-expect-error` (`examples/_shared/components/deckgl-overlay.tsx:10-16`; `examples/cog-globe/src/App.tsx:122-124`).
- Under React StrictMode, the overlay needs `deviceProps: { _reuseDevices: true }`; otherwise attaching to MapLibre's context can throw "WebGL context already attached to device" (`deckgl-overlay.tsx:18-36`).
- `MeshTextureLayer` deliberately leaves `image` out of its `defaultProps`: "putting `image` in defaultProps causes Maplibre to fail to render labels in interleaved mode" (`mesh-layer.ts:55-57`).
- 17 examples use MapLibre and none uses Mapbox GL (see 5.0). Mapbox GL should work through the same `MapboxOverlay` (inferred, untested).

### 4.4 Picking and reading pixel values

- `MeshTextureLayer` keeps `SimpleMeshLayer`'s picking colour (`picking_getPickingColorFromInstanceID()`, `mesh-layer-vertex.glsl.ts:60`). Each tile is one mesh with `data: { length: 1 }` (`raster-layer.ts:415`).
- Inferred: with `pickable: true`, a pick reports the tile's sublayer and a coordinate, but no pixel value.
- **There is no API for reading a raster value at a location**, and no example or doc does it (see 7.4).
- On the CPU, an app could build one from `@developmentseed/geotiff`:
  1. Project the lng/lat into the COG's CRS with the source's projection functions (`COGSource.projection`, `cog-source.ts:94-95`; `projectionFunctions` from `@developmentseed/proj`).
  2. `geotiff.index(x, y)` gives the row and column (`packages/geotiff/src/geotiff.ts:584-590`).
  3. `geotiff.read({ window })` fetches the pixels (`geotiff.ts:567-571`).
- A GPU readback (picking the shader's output) isn't offered either.

### 4.5 World copies and the antimeridian, as a user sees them

- **A tile crossing +/-180°** is meshed in one piece "the short way across" and cut at the world's edge, so each part is drawn inside the world (`raster-layer.ts:124-134, 273-313`). `RasterTileLayer` turns this on in Web Mercator with `_wrapX = 512` (`raster-tile-layer.ts:807-809`).
- **`MapView` with `repeat: true`:** the traversal runs extra passes shifted by up to +/-3 world copies, and selects a tile if any pass selects it (`raster-tile-traversal.ts:66, 1063-1080`).
- **Bounds:** `geographicBounds` takes the short way across the antimeridian: `west` is in [-180, 180) and `east` may run past 180, which MapLibre's `fitBounds` accepts (`raster-source.ts:3-14`; `packages/deck.gl-geotiff/src/geotiff/geotiff.ts:114-120`).
- **`MosaicLayer`:**
  - It accepts bboxes with `minX > maxX` (GeoJSON / STAC) and indexes such an item as two boxes (`mosaic-tileset-2d.ts:30-36, 203-222`).
  - Viewport bounds are normalized and split at +/-180° (`raster-tileset/visible-world-bounds.ts:9-28`).
  - Load priority measures longitude the short way around (`mosaic-layer.ts:206-244`).
- **Without `repeat`,** Web Mercator draws nothing past +/-180° (`visible-world-bounds.ts:13-17, 23-25`).
- `examples/explainers/antimeridian-explainer` animates the `_wrapX` path (see 5.1).

### 4.6 Other integration notes

- **Standard deck.gl layer props** reach the per-tile layers through `getSubLayerProps`: `opacity`, `visible`, `parameters`, `extensions` and so on (`raster-tile-layer.ts:812-833`). `MosaicLayer` hands them to `renderSource` as `subLayerProps` (`mosaic-layer.ts:354-362, 414-424`).
- **Clipping:** deck.gl's `ClipExtension` with `clipByInstance: false` clips per pixel; `usgs-topo` uses it (see 5.1). It replaced the old `CutlineBbox` module in 0.9 ([#739], see 7.1).
- **WebGL2 only:** GLSL modules, and the WGSL shader is dropped (`mesh-layer.ts:96-97, 184-188`). One table entry uses a WebGL-only format, `rgb16unorm-webgl` ("supported on WebGL2 but not supported on WebGPU", `texture.ts:175-178`).

---

## 5. Examples

### 5.0 Conventions shared by the examples

- Three tiers, stated in `examples/README.md`:
  - Main examples "show **how to use deck.gl-raster, specifically**... intended for learning/reuse"; the UI "is entirely LLM generated and should not be learned from" (`examples/README.md:5-9`).
  - `experimental/`: published "before their architecture has been reviewed and endorsed... **not** intended for learning or reuse" (`examples/README.md:11-19`).
  - `explainers/`: animated explanations of internals; "LLM-generated and unreviewed" (`examples/README.md:21-28`).
- All are Vite + React apps using a private shared Chakra UI package `deck.gl-raster-examples-shared` (`examples/README.md:40-47`, `examples/_shared/README.md:1-8`).
- Basemap: 17 examples depend on `maplibre-gl ^5.24.0` + `react-map-gl ^8.1.3`; only `custom-projection` and `cog-terrain` use pure `@deck.gl/react` `DeckGL` (tally of example `package.json` deps). No example uses Mapbox GL.
- MapLibre integration is one shared component: `MapboxOverlay` from `@deck.gl/mapbox` mounted via `react-map-gl`'s `useControl`, always with `interleaved` (`examples/_shared/components/deckgl-overlay.tsx:10-16`). It forces `deviceProps: { _reuseDevices: true }` to survive React StrictMode double-mount ("WebGL context already attached to device") (`deckgl-overlay.tsx:18-36`).
- Layers are slotted into the MapLibre style with `beforeId`, which needs `// @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps doesn't know about it.` (e.g. `examples/cog-basic/src/App.tsx:183-185`).
- Tile debug overlay is a standard control: `debug`, `debugOpacity`, and `debugLevel` 1-3 ("supported by `MultiCOGLayer`, not plain `COGLayer`") (`examples/_shared/components/debug-controls.tsx:4-14`).
- Run: `pnpm install`, then `cd examples/<name> && pnpm dev` (`examples/README.md:30-38`); per-example READMEs add `pnpm build` (e.g. `examples/naip-mosaic/README.md:9-23`).
- Deployment: `.github/workflows/docs.yml:42-67` builds every `examples/*/`, `examples/experimental/*/`, `examples/explainers/*/` that has a `build` script and copies `dist` to `docs/static/examples/<basename>` (flat URL space, so experimental/explainer examples publish at `/deck.gl-raster/examples/<name>/`).

### 5.1 Inventory (tracked examples)

Tracked file counts from `git ls-files examples`. "Docs page" = listed on the docs site examples page (`docs/src/pages/examples/index.tsx`: `cogExamples` :23, `zarrExamples` :153, `experimentalExamples` :235, `explainerExamples` :319). Every example's `vite.config.ts` sets `base: "/deck.gl-raster/examples/<name>/"` and `server.port: 3000` (`sentinel-2` uses 3001, `examples/sentinel-2/vite.config.ts:9`); `worker: { format: "es" }` unless noted.

Main examples (COG):

- `cog-basic` - one `COGLayer` from a URL, dropdown of 11 public COGs (Sentinel-2 TCI NYC, Sentinel-2 Fiji across the antimeridian, NZ 10 m RGB EPSG:2193, NAIP, NLCD, EOxCloudless EPSG:4326, Swisstopo, ortho pan, Umbra SAR rotated COG, USGS topo) plus dev-only antimeridian fixtures; MapLibre interleaved; `onSourceLoad` fits bounds (`examples/cog-basic/src/App.tsx:70-155, 167-186`). Vite quirk: dev-only `localFixtures()` middleware serving `fixtures/geotiff-test-data` with HTTP Range/206 support (`examples/cog-basic/vite.config.ts:14-72`). Docs page: "RGB GeoTIFF".
- `cog-globe` - same `COGLayer` on MapLibre `projection="globe"`, interleaved, with `parameters: { depthCompare: "always" }` against z-fighting with the basemap sphere (`examples/cog-globe/src/App.tsx:99-125, 137-153`). Docs page: "Globe View".
- `land-cover` - 1.3 GB NLCD uint8 COG with `COGLayer` + custom `getTileData` (uploads `r8uint`) + custom integer shader modules (`CreateTextureUint`, `FilterCategory`, `PaletteColormap`) for per-category filtering; custom `epsgResolver` from the offline `@developmentseed/epsg` DB + `parseWkt`; exposes a `maxError` (mesh error) slider (`examples/land-cover/src/App.tsx:1-5, 27-41, 50, 143`; `src/get-tile-data.ts:13-49`; `src/render-tile.ts:24-48`; `src/gpu-modules/create-texture-uint.ts:10-35`). Vite quirk: `assetsInclude: ["**/*.csv.gz"]` for the EPSG CSV (`examples/land-cover/vite.config.ts:6`). Docs page: "Land Cover".
- `naip-mosaic` - `MosaicLayer` of NAIP STAC items around Denver (pre-baked `minimal_stac.json` from a Planetary Computer search, `examples/naip-mosaic/README.md:28-49`) each drawn by a `COGLayer` with custom `getTileData` (`rgba8unorm`) and three `renderTile` modes: true color, false-color IR, NDVI + range filter + colormap; optional COG outlines `PathLayer`; custom `epsgResolver` from a hard-coded proj4 UTM table (`examples/naip-mosaic/src/App.tsx:72-98, 210-286, 402-447`; `src/proj.ts:1-21`). Docs page: "NAIP Mosaic".
- `sentinel-2` - `MultiCOGLayer` composing separate per-band Sentinel-2 COGs at different resolutions (10 m + 20 m) into RGB presets via `composite: { r, g, b }`, `renderPipeline: [FilterNoDataVal(0), LinearRescale(0..0.05)]`, `resampling` toggle, `debugLevel` (`examples/sentinel-2/src/App.tsx:4-7` imports, `:23-27` band resolutions, `:92-131` 8 presets of `sources` + `composite`, `:150-159` per-band URL record, `:161-189` the layer with `renderPipeline` at `:169-172`). Docs page: "Sentinel-2 Multi-Band".
- `usgs-topo` - historical USGS topo GeoTIFFs with the default pipeline, clipped to the quad's data area with deck.gl `ClipExtension` (`clipBounds`, `clipByInstance: false` for per-pixel clipping) (`examples/usgs-topo/src/App.tsx:84-114`). Docs page: "USGS Historical Topo Maps".
- `vermont-cog-comparison` - swipe comparison of two `COGLayer`s (Vermont statewide imagery 1974-2025, EPSG:32145) using `ClipExtension`; per-side grayscale / true color / false-color IR / NDVI; hard-coded proj4 WKT2 table as `epsgResolver` (`examples/vermont-cog-comparison/src/App.tsx:136-178`; `src/render-pipelines.ts:14-81`; `src/proj.ts:11-38`). Uses MapLibre interleaved with rotation/pitch locked (`App.tsx:456-479`). Docs page: "Before/After Comparison".
- `vrt-mosaic` - USGS 3DEP 1 arc-second seamless DEM VRT (3,811 one-degree COGs) parsed with `parseVRT` into `MosaicLayer` items, opened with `COGSource.open` only when in view and past zoom 7; Float32 elevation needs custom `getTileData` (`r32float`) and `renderTile` (`FilterNoDataVal` -> `LinearRescale` -> `Colormap`) (`examples/vrt-mosaic/README.md:9-15`; `src/elevation.ts:34-101`; `src/App.tsx:170-191`). Docs page: "VRT Mosaic".

Main examples (Zarr):

- `dynamical-zarr-ecmwf` - ECMWF IFS ENS 15-day 0.25° float32 Zarr v3 (consolidated) via `ZarrSource.open(store, { path, geoZarrMetadata })` with injected GeoZarr attrs (store isn't GeoZarr-compliant); `selection` pins `init_time` and `ensemble_member`, keeps all 85 `lead_time`s; each chunk uploaded as an `r32float` 2D-array texture and animated by changing a uniform (custom `SampleTexture2DArray` + `FilterRange` modules, then `LinearRescale` + `Colormap`) (`examples/dynamical-zarr-ecmwf/src/App.tsx:47, 112-135, 217-238`; `src/ecmwf/metadata.ts:1-22`; `src/ecmwf/selection.ts:17-25`; `src/ecmwf/get-tile-data.ts:20-70`; `src/ecmwf/render-tile.ts:39-78`). Docs page: "ECMWF Temperature Forecast".
- `zarr-globe` - the ECMWF AIFS deterministic 2 m temperature forecast animated on MapLibre `projection="globe"` (each chunk 60° x 60°, whole globe = 18 requests) (`examples/zarr-globe/README.md:1-8`; `src/App.tsx:40-41, 110-136, 193-221, 235-246`). Docs page: "Globe View".
- `aef-mosaic` - AlphaEarth Foundations GeoZarr mosaic, `int8` 64-band embeddings; selection pins `time`, keeps all 64 bands; all bands uploaded per tile as one `r8sint` Texture2DArray and three chosen as RGB in the shader with dequantization `(v/127.5)^2 * sign(v)`; `minZoom: 10`, `maxCacheSize: 10` (`examples/aef-mosaic/README.md:1-9`; `src/App.tsx:51-54, 94-109`; `src/aef/selection.ts:16-23`; `src/aef/constants.ts:42`). Docs page: "AEF Mosaic Embeddings".
- `nldas-icechunk` - one timestep of NLDAS-3 air temperature from a virtual Icechunk repo via `icechunk-js` (`virtualChunkContainers`), `ZarrLayer` float32 with hard-coded GeoZarr attrs "because the virtual store is not GeoZarr-compliant" (`examples/nldas-icechunk/README.md:1-30`; `src/nldas/store.ts:32-60`; `src/App.tsx:119-141`). Docs page: "NLDAS Icechunk".
- `zarr-sentinel2-tci` - `ZarrLayer` over a GeoZarr multiscale Sentinel-2 TCI (EPSG:32612); `selection: { band: null }`; `renderTile` returns `{ image: ImageData }` (no GPU pipeline) (`examples/zarr-sentinel2-tci/src/App.tsx:34-54, 104-114, 139`). Its store is `http://localhost:8080/TCI.zarr`, "generated locally from developmentseed/geozarr-examples#36" (`App.tsx:20-22`). **Not on the docs page**, though `docs.yml` still builds and deploys it (it has a `build` script, `examples/zarr-sentinel2-tci/package.json:7`).

Experimental (`examples/experimental/`, all badged; READMEs say "LLM-generated and unreviewed" except custom-projection):

- `custom-projection` - COGs (GEBCO elevation, NASA Antarctic basemap EPSG:3031, EOxCloudless) plus ITS_LIVE ice-velocity overlays in Arctic Polar Stereographic (EPSG:3413), Antarctic Polar Stereographic (EPSG:3031), Equal Earth (EPSG:8857) and Web Mercator through a custom view; graticule and coastlines drawn by deck.gl, no basemap (`examples/experimental/custom-projection/README.md:1-48`; `src/projections.ts:34-80`; `src/datasets.ts:55-79`; `src/overlays.ts:46-61`; `src/App.tsx:304-309`). Docs page: "Preview: Custom Projections". See 5.4.
- `cog-terrain` - COGs (9 NAIP tiles in UTM 13N around Pikes Peak, Swiss LV95 map, 1962 USGS NAD27 polyconic map) draped over Terrain Tiles with deck.gl's experimental `_TerrainExtension` (`terrainDrawMode: "drape"`, `zRange` measured from terrain tiles), `MapView` + `TerrainController` (`examples/experimental/cog-terrain/README.md:1-72`; `src/App.tsx:298-305, 393-422`). Docs page: "Rasters over Terrain".
- `geoarrow-overlay` - EOxCloudless COG (EPSG:4326) under 3.4 M Ookla points from deck.gl-geoarrow (`GeoArrowScatterplotLayer`) read from Parquet with parquet-wasm; GPU filtering via `DataFilterExtension` (`examples/experimental/geoarrow-overlay/README.md:1-58`; `src/App.tsx:120-154`). Docs page: "GeoArrow Overlay".
- `pmtiles-terrain` - GPU hillshade/slope/tinted relief from Mapterhorn's Terrarium-encoded WebP `planet.pmtiles`, read through `@developmentseed/range-reader` by a `RasterTileLayer` subclass (`PMTilesTerrainLayer`); 514 x 514 `r32float` textures with a 1-px halo from neighbors (`examples/experimental/pmtiles-terrain/README.md:1-90`; `src/App.tsx:41, 228-260`). Vite: no `worker.format` (no GeoTIFF decoding) (`vite.config.ts:4-13`). Docs page: "Hillshade from PMTiles".
- `titiler-cog` - `RasterTileLayer` fed by a titiler server: TMS document -> `TileMatrixSetAdaptor` as `tilesetDescriptor`; tiles fetched as `.npy` (uint8 RGB + mask band), decoded with npyjs, rendered with `CreateTexture` + `MaskTexture` (`examples/experimental/titiler-cog/README.md:1-51`; `src/App.tsx:62-82`; `src/titiler.ts:132-157, 249-260`). Docs page: "Titiler Tiles".

Explainers (`examples/explainers/`):

- `reprojection-explainer` - step-by-step animation of the adaptive triangle-mesh GPU reprojection (NLCD Albers -> Web Mercator; Arctic lon/lat -> EPSG:3413), toggles the experimental `_errorSpace` ("input" vs "output" pixels); draws with its own `TexturedTrianglesLayer` and reads `RasterReprojector`'s private refinement queue (`examples/explainers/reprojection-explainer/README.md:1-45`). Vite: no `worker.format` (`vite.config.ts:4-10`).
- `multi-cog-explainer` - how `MultiCOGLayer` stitches per-band tiles of different resolutions (UV transforms, `CompositeBands`), using the public building blocks `selectSecondaryLevel`, `resolveSecondaryTiles`, `fetchTiles`, `assembleTiles` (`examples/explainers/multi-cog-explainer/README.md:1-45`).
- `antimeridian-explainer` - how `RasterLayer`'s `_wrapX` path unwraps, snaps, meshes and cuts an image crossing +/-180°; calls non-exported `makeUnwrappedReprojectionFns`, `clipMeshToWorld`, `rescaleEPSG3857ToCommonSpace` through a private Vite alias into `packages/deck.gl-raster/dist/` (`examples/explainers/antimeridian-explainer/README.md:1-49`; `vite.config.ts:5-29`).

Docs page totals: 8 COG + 4 Zarr + 5 experimental + 3 explainers = 20 (`docs/src/pages/examples/index.tsx:463-486` headings "COG Examples", "Zarr Examples", "Experimental Examples", "Explainers").

### 5.2 (a) Minimal code: showing a COG

Package README quick start (standalone deck.gl, no basemap) (`packages/deck.gl-geotiff/README.md:13-31`):

```ts
import { Deck } from '@deck.gl/core';
import { COGLayer } from '@developmentseed/deck.gl-geotiff';

new Deck({
  initialViewState: { longitude: 0, latitude: 0, zoom: 2 },
  controller: true,
  layers: [new COGLayer({ id: 'cog-layer', source: 'https://example.com/my-cog.tif' })],
});
```

Opening the source first to read bounds or pass options (`packages/deck.gl-geotiff/README.md:49-55`):

```ts
const source = await COGSource.open("https://example.com/my-cog.tif");
const { west, south, east, north } = source.geographicBounds;
new COGLayer({ id: "cog", source });
```

What `cog-basic` actually does, over MapLibre (`examples/cog-basic/src/App.tsx:167-186, 190-210`):

```tsx
const cogLayer = new COGLayer({
  id: "cog-layer",
  source: selected.url,
  debug: debugState.debug,
  debugOpacity: debugState.debugOpacity,
  onSourceLoad: (source) => {
    const { west, south, east, north } = source.geographicBounds;
    mapRef.current?.fitBounds([[west, south], [east, north]], { padding: 40, duration: 1000 });
  },
  // @ts-expect-error beforeId is injected by @deck.gl/mapbox; ...
  beforeId: "boundary_country_outline",
});
// <MaplibreMap ...><DeckGlOverlay layers={[cogLayer]} interleaved /></MaplibreMap>
```

No `renderTile`/pipeline is passed: `COGLayer` infers one from the GeoTIFF metadata (`docs/guides/intro.md:24`; `docs/guides/intro.md:128`). Pixel-to-map reprojection (NZTM2000 EPSG:2193 -> Web Mercator, etc.) is automatic (`examples/cog-basic/README.md:10`).

### 5.3 (b) NDVI band math with a colormap

Yes: `naip-mosaic` (with GPU range filter) and `vermont-cog-comparison` (simpler, no filter). No example in the docs/guides; the v0.4 blog post describes the NAIP one (`docs/blog/2026-03-20-v0.4-release.md:20-38`). Band math is written as a luma.gl `ShaderModule` injecting GLSL into the `fs:DECKGL_FILTER_COLOR` hook, where `color` holds the sampled bands; modules run in pipeline order.

1. Upload the 4 bands (R, G, B, NIR) as one normalized RGBA texture in a custom `getTileData` (`examples/naip-mosaic/src/App.tsx:72-98`):

```ts
const tile = await image.fetchTile(x, y, { signal, boundless: false });
const { width, height, data } = tile.array; // pixel-interleaved
const texture = device.createTexture({ data, format: "rgba8unorm", width, height });
return { texture, height, width };
```

2. NDVI module writes the raw index into `color.r` (`examples/naip-mosaic/src/App.tsx:154-164`):

```ts
const normalizedDifference = {
  name: "normalizedDifference",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float nir = color[3];
      float red = color[0];
      color.r = (nir - red) / (nir + red);
    `,
  },
};
```

3. A filter module with uniforms (`uniformTypes` + `getUniforms` + a GLSL uniform block whose name must match the module name) discards pixels outside `[ndviMin, ndviMax]` (`examples/naip-mosaic/src/App.tsx:166-202`).

4. Pipeline from `renderTile` (`examples/naip-mosaic/src/App.tsx:256-286`):

```ts
const renderPipeline: RasterModule[] = [
  { module: CreateTexture, props: { textureName: texture } },
  { module: normalizedDifference },
  { module: ndviFilter, props: { ndviMin: ndviRange[0], ndviMax: ndviRange[1] } },
  { module: LinearRescale, props: { rescaleMin: -1, rescaleMax: 1 } },
  { module: Colormap, props: { colormapTexture, colormapIndex, reversed: colormapReversed } },
  { module: SetAlpha1 },
];
return { renderPipeline };
```

5. The colormap texture is a shipped sprite PNG that the app must fetch, decode and upload once the luma.gl `Device` exists (`examples/naip-mosaic/src/App.tsx:19, 366-397`; `onDeviceInitialized={setDevice}` at :494):

```ts
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
const image = await decodeColormapSprite(await (await fetch(colormapsPngUrl)).arrayBuffer());
setColormapTexture(createColormapTexture(device, image));
// colormapIndex: COLORMAP_INDEX.cfastie | rdylgn | greens | ylgn | viridis | spectral (src/colormap-choices.ts:25-62)
```

6. Wiring (`examples/naip-mosaic/src/App.tsx:402-433`): `MosaicLayer({ data: stacItems, getSource: (item, options) => COGSource.open(item.assets.image.href, { ...options, epsgResolver }), renderSource: (_item, { source, subLayerProps }) => new COGLayer<TextureDataT>({ ...subLayerProps, source, getTileData, renderTile, onTileUnload: (tile) => tile.content?.texture.destroy() }) })`.

Simpler variant: `Ndvi` module maps `(ndvi + 1) / 2` into `color.r` itself, then `Colormap` (`examples/vermont-cog-comparison/src/shaders.ts:42-52`; `src/render-pipelines.ts:66-81`).

Related band-math-like examples: false-color IR band reordering (`examples/naip-mosaic/src/App.tsx:133-144`); `MultiCOGLayer` `composite: { r: "swir2", g: "swir1", b: "blue" }` across separate band files (`examples/sentinel-2/src/App.tsx:120-121, 161-165`); AEF picks 3 of 64 bands in-shader (`examples/aef-mosaic/README.md:6-9`).

### 5.4 (c) Rendering in a projection other than Web Mercator

Custom planar projections - `examples/experimental/custom-projection` (experimental; README warning: "demonstrate how deck.gl-raster will support custom projections in the future once deck.gl v10 is released", visgl/deck.gl#10739, `README.md:8-14`). Two example-local pieces, neither in the library:

- `CustomProjectionView`, an interim shim extending deck.gl's `OrthographicView` that stands in for upstream `_CustomProjectionView` (visgl/deck.gl#10741, "merged after deck.gl 9.4.0"); swap the import for `import { _CustomProjectionView as CustomProjectionView } from "@deck.gl/core"` once shipped (`src/custom-projection/custom-projection-view.ts:46-80`). Props: `projection` (`{forward, inverse}`, e.g. a proj4 converter), `fromCrs`, `toCrs`, `fromBounds` (`:14-28`).
- `ProjectedCOGLayer extends COGLayer`, which in a custom-projection viewport swaps in its own `CustomProjectionTileset2D` and one `RasterLayer` per tile drawn with `coordinateSystem: "cartesian"`; "lives in the example rather than in deck.gl-raster while upstream's API settles" (`src/projected-cog-layer/projected-cog-layer.ts:58-85`). Extra prop `fromBounds` (`:37-50`).

Minimal code (`examples/experimental/custom-projection/src/App.tsx:57-58, 136-156, 206-228, 270-278`; preset from `src/projections.ts:35-45`):

```tsx
const FROM_CRS = "EPSG:4326";
const toCrs = "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"; // EPSG:3413
const fromBounds = [-180, -20, 180, 90];
const converter = proj4(FROM_CRS, toCrs);
const view = new CustomProjectionView({
  id: "map", controller: true, projection: converter, fromCrs: FROM_CRS, toCrs, fromBounds,
});
const layer = new ProjectedCOGLayer({ id: "cog", source: url, fromBounds });
<DeckGL views={view} initialViewState={{ center: [-135, 68.2, 0], zoom: 2.6 }} layers={[layer]} />
```

No basemap: "Maplibre doesn't support custom projections; everything is drawn by deck.gl" (`src/App.tsx:304-309`).

Globe (supported today via MapLibre's globe, not a direct deck.gl `GlobeView` in any example):

- `cog-globe`: `<MaplibreMap projection="globe">` + `<DeckGlOverlay interleaved>` and `COGLayer({ ..., parameters: { depthCompare: "always" } })`; the overlay-created `GlobeView` "culls back faces by default (deck.gl >= 9.4)" (`examples/cog-globe/src/App.tsx:115-121, 146`).
- `zarr-globe`: same setup with `ZarrLayer` (`examples/zarr-globe/src/App.tsx:193-221, 237`).
- No tracked example constructs deck.gl `_GlobeView` or `OrbitView` directly (grep of tracked example sources).
- Docs: "Preliminary GlobeView support... _Some projections may render with some distortion_... using a fixed number of resampling points, instead of the more accurate dynamic resampling approach used in the standard Web Mercator `MapView`" (`docs/blog/v0.8-release.md:20-31`).

Terrain (3D, Web Mercator `MapView`): `cog-terrain` drapes `COGLayer` via `_TerrainExtension` (`examples/experimental/cog-terrain/README.md:30-57`):

```ts
const cogProps: COGLayerProps & TerrainExtensionProps = {
  id: "cog", source: "https://example.com/image.tif",
  extensions: [new TerrainExtension()],
  terrainDrawMode: "drape",
  zRange: [500, 2100], // meters; the example measures it from the terrain
};
```

### 5.5 Bundler configuration across examples

- `worker: { format: "es" }` in every example except `experimental/pmtiles-terrain` and `explainers/reprojection-explainer` (neither decodes GeoTIFFs) (grep of all tracked `vite.config.ts`).
- `land-cover`: `assetsInclude: ["**/*.csv.gz"]` and `import epsgCsvUrl from "@developmentseed/epsg/all.csv.gz?url"` (`examples/land-cover/vite.config.ts:6`; `src/App.tsx:3-4`).
- `cog-basic`: dev-only Range-capable fixture middleware (`examples/cog-basic/vite.config.ts:14-72`).
- `antimeridian-explainer`: `resolve.alias` for `@developmentseed/deck.gl-raster/internal/*` -> package `dist/` (`examples/explainers/antimeridian-explainer/vite.config.ts:5-29`).
- No example uses `optimizeDeps` or other bundler workarounds.
- Asset import of the colormap sprite via a package export: `@developmentseed/deck.gl-raster/gpu-modules/colormaps.png` (`packages/deck.gl-raster/package.json:17`); Vite resolves it to a URL by default.

---

## 6. Documentation

### 6.1 Docs site structure (Docusaurus 3.10.2)

- Site: `https://developmentseed.github.io` + `baseUrl: "/deck.gl-raster/"` (`docs/docusaurus.config.ts:274-275`); title/tagline "Client-side Cloud-Optimized GeoTIFF and Zarr visualization in deck.gl." (`:264-267`). Docusaurus deps (`docs/package.json:19-31`).
- Navbar: Docs (guides sidebar), Examples, Blog, API Reference dropdown (one entry per package), GitHub (`docs/docusaurus.config.ts:365-388`).
- Narrative docs ("Docs"): the classic preset's docs plugin reads `docs/guides/`, routed at `/docs`, sidebar autogenerated (`docs/docusaurus.config.ts:332-341`; `docs/sidebars.ts:3-5`). Tracked content is only `docs/guides/intro.md` (Introduction / "Getting Started" footer link, `docusaurus.config.ts:396`). `docs/guides/changelog.md` is generated at build from the root `CHANGELOG.md` by `docs/plugins/changelog.js:13-27` and gitignored (`docs/.gitignore:2`).
- API reference: one `docusaurus-plugin-typedoc` + one `@docusaurus/plugin-content-docs` instance per package (12: affine, deck.gl-geotiff, deck.gl-raster, deck.gl-raster/gpu-modules, deck.gl-zarr, epsg, geotiff, geozarr, morecantile, proj, range-reader, raster-reproject) (`docs/docusaurus.config.ts:13-86, 230-262`). TypeDoc runs with `excludePrivate/Protected/Internal`, `mergeReadme: true` (the package README becomes the "Overview" page), `typedoc-plugin-no-inherit`, cross-package symbol links (`:108-228, 240-247`). Each per-package sidebar is "Overview" + generated typedoc sidebar (`docs/api-sidebars/deck-gl-geotiff.cjs:3-8`). Output `docs/api/*` is gitignored and regenerated each build (`docs/.gitignore:1`; `docs/README.md:19-20`).
- Blog: release posts and feature posts, math via remark-math/rehype-katex (`docs/docusaurus.config.ts:342-347`). Tracked: v0.3, v0.4, multi-band-cog, initial-geozarr, v0.7, v0.8, v0.9 (`git ls-files docs/blog`). The v0.10 post was still a draft (published later in [#869]).
- Examples page: custom React page `docs/src/pages/examples/index.tsx` with four sections (see 5.1); the apps themselves are built and copied into `docs/static/examples/` by CI (`.github/workflows/docs.yml:42-67`).
- Homepage: three feature cards: "GPU-Accelerated Raster Rendering... using WebGL2 via deck.gl and luma.gl. Color mapping, compositing, and reprojection happen entirely on the GPU"; "Cloud-Optimized Formats... COGs and Zarr arrays directly from object storage - no tiling server required"; "Flexible Visualization Pipeline: Compose raster modules for band math, nodata masking, and color mapping... or write your own custom shader code" (`docs/src/components/HomepageFeatures/index.tsx:13-60`).
- Search: `@easyops-cn/docusaurus-search-local` over docs, api and blog (`docs/docusaurus.config.ts:315-322`).
- Build output dirs `docs/build/` and `docs/deck.gl-raster/` (symlink target for `pnpm serve`, `docs/package.json:13`) are gitignored (`docs/.gitignore:8-9`); `git ls-files docs` has 96 files, none under them.

### 6.2 README quick starts

- Root `README.md:1-24`: tagline, docs link, and example screenshots only. **No install command or code.**
- `docs/guides/intro.md` (the "Getting Started" page): feature list (`:15-30`), package table (`:34-50`), an ASCII architecture diagram (Application layer: `COGLayer`/`MultiCOGLayer`/`MosaicLayer`/`ZarrLayer` + `COGSource`/`MultiCOGSource`/`ZarrSource`; Raster processing: `RasterTileLayer`, `RasterLayer`, `RasterTileset2D`, GPU modules; Reprojection: `RasterReprojector` + proj4; Data: geotiff, range-reader, zarrita) (`:94-124`), concepts: Sources, Render Pipeline, Adaptive Mesh Reprojection, Tile Streaming, Zero-Copy Texture Upload (`:126-134`). **No code, no install steps.**
- `packages/deck.gl-geotiff/README.md`: Quick Start (`:13-31`), layer/source table (`:41-45`), `COGSource.open` (`:47-55`), `MosaicLayer` + `parseVRT` (`:57-77`), "Using Vite" (`:79-94`), "Requests, caching and authentication" (shared `RangeReader`, tuning, `requestInit` auth, `maxRequests: 256` / `debounceTime: 50` defaults, per-origin limiter of 6) (`:96-143`).
- `packages/deck.gl-zarr/README.md`: Quick Start with `zarr.FetchStore` + `ZarrLayer({ source: store, selection: { band: null }, getTileData, renderTile })` (`:15-32`); `ZarrSource.open(store, { path })` + `source.is("float32")` (`:34-54`); callbacks contract (`:68-75`); features (`:77-82`).
- `packages/deck.gl-raster/README.md:1-13`: purpose plus the repo's only install command, `npm install @developmentseed/deck.gl-raster` (`:12`).
- `packages/deck.gl-raster/GPU_MODULES.md:1-17`: modules are luma.gl `ShaderModule`s composed as `RasterModule[]`; snippet `[{ module: FilterNoDataVal, props: { value: 0 } }, { module: LinearRescale, props: { rescaleMin: 0, rescaleMax: 0.05 } }]`; order "decoding... numeric transforms (`LinearRescale`), then maps values to colors (`Colormap`, `BlackIsZero`, `CMYKToRGB`)".
- `packages/geotiff/README.md`: `GeoTIFF.fromUrl` + `fetchTile` with layout narrowing (`:20-79`), overviews (`:81-92`), `read({ window })` (`:94-111`), `DecoderPool` (`:138-164`), custom decoders via `DECODER_REGISTRY` (`:166-187`), chunkd sources (`:189-214`), HTTP via `RangeReader` (`:224-268`).
- `packages/epsg/README.md:20-39`: `loadEPSG()` -> `Map<number, string>` of WKT2 for all 7352 EPSG codes, 309 kB gzipped, decompressed with `DecompressionStream` (`:3, :7`).
- `packages/range-reader/README.md:25-82`: usage, options table with defaults (`:62-72`).
- `packages/geozarr/README.md:14-29`: `parseGeoZarrMetadata(group.attrs)`; implements `spatial`, `multiscales`, `geo-proj` conventions (`:8`). The convention specs are git submodules at v1, maturity "Proposal" (`.gitmodules`; `packages/geozarr/spatial/README.md`, `multiscales/README.md`, `geo-proj/README.md` headers).
- `packages/proj/README.md:1-7`, `packages/affine/README.md:1-5`, `packages/morecantile/README.md:1-12`, `packages/raster-reproject/README.md:1-5`: one-paragraph descriptions, no code.
- Contributor setup: `git submodule update --init --recursive`, `pnpm install`, `pnpm build` (`DEVELOP.md:7-22`); toolchain pins pnpm 10.25.0, Node 24.21.0 (root `package.json:45-47`).

### 6.3 What a new user must know or set up

1. Packages and peers. Published packages are ESM-only (`"type": "module"`, `exports` with only `default`; e.g. `packages/deck.gl-raster/package.json:5-18`). Peer dependencies:
   - `@developmentseed/deck.gl-geotiff`: `@deck.gl/core`, `@deck.gl/geo-layers`, `@deck.gl/layers`, `@deck.gl/mesh-layers`, `@luma.gl/core`, all `^9.4.0` (`packages/deck.gl-geotiff/package.json:59-65`).
   - `@developmentseed/deck.gl-raster`: the same plus `@luma.gl/shadertools ^9.4.0` and `@developmentseed/morecantile` (a peer, `workspace:^`) (`packages/deck.gl-raster/package.json:55-63`).
   - `@developmentseed/deck.gl-zarr`: `@deck.gl/core`, `geo-layers`, `layers`, `@luma.gl/core` `^9.4.0`; `zarrita ^0.7.5` is a regular dependency (`packages/deck.gl-zarr/package.json:56-61`).
   - No README lists these, and the only documented install command is for `deck.gl-raster` (`packages/deck.gl-raster/README.md:12`).
2. Bundler. GeoTIFF tiles decode in a Web Worker that uses top-level await and dynamic imports; with Vite, `vite build` fails unless `worker: { format: "es" }` (error text quoted for Vite 7 and 8); `vite dev` works without it (`packages/deck.gl-geotiff/README.md:79-94`; `packages/geotiff/README.md:153-164`). The worker is created with `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })` (`packages/geotiff/src/pool/pool.ts:137-147`). No other bundler (webpack, Next.js, Rollup) is mentioned in any README, guide or blog post.
3. Worker pool. `COGLayer` uses `this.props.pool ?? defaultDecoderPool()` (`packages/deck.gl-geotiff/src/cog-layer.ts:95-98, 205`), so workers are on by default (size `navigator.hardwareConcurrency`, fallback 2, `packages/geotiff/src/pool/pool.ts:9-31`). Using `@developmentseed/geotiff` directly, "Without a pool, tiles are decoded on the main thread" (`packages/geotiff/README.md:149`).
4. CRS resolution. A GeoTIFF with an EPSG code returns the integer and leaves resolution to the app; a user-defined CRS in GeoKeys is parsed natively to PROJJSON "without a large cache of PROJ data" (`packages/geotiff/README.md:126-136`). Default `epsgResolver`: codes proj4 ships (4326, 4269, 3857, UTM zones) resolve offline; **any other code is fetched from `https://epsg.io/{code}.json`** once and cached (`packages/proj/src/registry.ts:35-77`; documented on the option at `packages/deck.gl-geotiff/src/cog-source.ts:39-49`; `packages/proj/README.md:5`). Offline alternatives shown in examples:
   - custom `epsgResolver` backed by `@developmentseed/epsg` + `parseWkt` (`examples/land-cover/src/App.tsx:1-5, 27-41`), which needs the CSV asset URL under Vite (`packages/epsg/src/all.ts:15-23`);
   - `proj4.defs(...)` tables wrapped in an `epsgResolver` (`examples/naip-mosaic/src/proj.ts:1-21`; `examples/vermont-cog-comparison/src/proj.ts:11-38`);
   - `registerProjection(epsg, wktOrProjjson)` exists (`packages/proj/src/registry.ts:20-33`) but no README, guide or example uses it.
   Note: there is no proj4 "registration" step needed for the default path; proj4 is a dependency of `@developmentseed/proj` (`packages/proj/package.json`).
5. Colormaps. Using the `Colormap` module requires fetching the shipped sprite (`@developmentseed/deck.gl-raster/gpu-modules/colormaps.png`), `decodeColormapSprite`, and `createColormapTexture(device, image)` after the luma.gl `Device` is available (via `onDeviceInitialized`); every colormap example repeats this (`examples/naip-mosaic/src/App.tsx:366-397`; `examples/zarr-globe/src/App.tsx:74-104`). Non-Vite bundlers need an asset loader for the PNG export (`packages/deck.gl-raster/package.json:17`).
6. Memory. "If you're defining your own `getTileData` that manually creates luma.gl `Texture` objects, make sure you also define `onTileUnload` which calls `Texture.destroy()`" (`docs/blog/v0.8-release.md:117`); examples do this (`examples/naip-mosaic/src/App.tsx:432`; `examples/titiler-cog/src/App.tsx:72-76`).
7. Requests and auth. All COG layers share one `RangeReader` (merge, stream, cache) by default; pass `requestInit` for headers/credentials; per-origin limit of 6 (`packages/deck.gl-geotiff/README.md:96-143`). Zarr: the app creates the zarrita store and owns consolidation, range coalescing and auth (`packages/deck.gl-zarr/README.md:82`). Data hosts must allow CORS and HTTP Range: not stated in any README; implied by the examples (e.g. Range middleware in `examples/cog-basic/vite.config.ts:14-20`) and by the range reader avoiding `If-Match` because it "forces a CORS preflight" (`packages/range-reader/README.md:112-114`).
8. Zarr specifics. `ZarrLayer` has no default rendering: the app supplies `getTileData(arr, options)` (call `zarr.get(arr, options.sliceSpec)`) and `renderTile(data)` (`packages/deck.gl-zarr/README.md:68-75`); `selection` must cover every non-spatial dimension (`null` = keep, number = pin, `zarr.Slice` = range) (`packages/deck.gl-zarr/README.md:26-28`; `docs/blog/initial-geozarr.md:53`); a store without GeoZarr attrs needs `geoZarrMetadata` passed to `ZarrSource.open` (`packages/deck.gl-zarr/README.md:34`), as three of the five Zarr examples do (`examples/dynamical-zarr-ecmwf/src/ecmwf/metadata.ts:1-22`; `examples/zarr-globe/src/App.tsx:117-120`; `examples/nldas-icechunk/README.md:29-30`).
9. MapLibre integration. Use `@deck.gl/mapbox` `MapboxOverlay` with `interleaved` and `beforeId` (untyped, needs `@ts-expect-error`); with React StrictMode pass `deviceProps: { _reuseDevices: true }` (`examples/_shared/components/deckgl-overlay.tsx:10-36`); on a MapLibre globe set `parameters: { depthCompare: "always" }` (`examples/cog-globe/src/App.tsx:115-121`). Extension props (`ClipExtension`'s `clipBounds`, `TerrainExtension`'s `terrainDrawMode`) are not in `COGLayerProps` and need `@ts-expect-error` or a separately built props object (`examples/usgs-topo/src/App.tsx:97-103`; `examples/experimental/cog-terrain/README.md:87-89`).
10. Graphics API: WebGL2 (`docs/src/components/HomepageFeatures/index.tsx:19`).


---

## 7. Limitations

### 7.0 Seen in the code (layers, GPU modules, views)

**Experimental or internal props:**
- `RasterLayer._wrapX`: "@internal Experimental; may change or be removed" (`raster-layer.ts:124-134`).
- `_errorSpace` is not a prop. `RasterLayer` hard-codes `"output"` (`raster-layer.ts:284-291`); `RasterReprojector`'s own default is `"input"` (`packages/raster-reproject/src/delatin.ts:231, 254`). Users can tune only `maxError`.
- `MultiCOGLayer` support for signed-int, uint32 and float bands is "**experimental**, and the units they arrive in are likely to change" (`multi-cog-layer.ts:163-167, 811-818`).
- `_renderDebugTileOutline` and `_visibleWorldBounds` are exported with a leading underscore and marked "Not a public API" (`packages/deck.gl-raster/src/index.ts:3-4, 44-45`).

**Data types the layers don't render out of the box:**
- `COGLayer` with signed ints or floats: the default pipeline is refused (2.5).
- `COGLayer` with uint32, 1-bit or more than 4 bands: fails on every tile.
- `ZarrLayer`: no default rendering at all.
- Integer textures need custom `usampler2D`/`isampler2D` modules (2.4).
- `MultiCOGLayer` can't read band-separate data, so LERC or PlanarConfiguration=2 files appear to fail (2.7).

**Pipeline issues:** see 2.7.
- The CIELab module looks like it wouldn't compile, and it and the CMYK module are never reached.
- A 4-band non-RGB image is drawn with band 4 as alpha.
- Nodata is tested on the red channel only.
- `COGLayer` has no `resampling` prop.
- One props slot per module name (inferred).

**Views:**
- `GlobeView` uses a throwaway uniform grid (`raster-layer.ts:239-262`; `globe-grid-mesh.ts:11-22`) and ignores `zRange` (`raster-tile-layer.ts:170`).
- No `OrbitView`/`OrthographicView` path; custom projections exist only in an example, pending deck.gl v10 (4.1).
- Rasters are flat; terrain comes only from deck.gl's experimental `_TerrainExtension` (4.2).

**`MosaicLayer`:**
- No `debounceTime` ([#562]) and no `maxCacheByteSize` ([#803]) (`mosaic-layer.ts:58-64`).
- No draw order for overlapping items (see 7.3).

**Zoom props:**
- `visibleMinZoom` and `visibleMaxZoom` are ignored (`raster-tileset-2d.ts:292-297`).
- `extent` doesn't keep tiles loading below `minZoom` (`:298-299`).
- `maxZoom` caps the level index, though its docstring says it is compared with `viewport.zoom` (`:287-291` vs `:345-350`); for the traversal researcher.

**Workarounds for upstream bugs, noted in the code:**
- luma.gl 9.4.2's `Model.destroy()` leaks a vertex array per model; `MeshTextureLayer` destroys it itself (`mesh-layer.ts:64-75, 136-160`).
- deck.gl's `Tileset2D.finalize` skips unloading until deck.gl#10883 lands (`mosaic-tileset-2d.ts:87-103`).
- deck.gl's `reloadAll` keeps old tiles ([#816], [#818]) (`mosaic-tileset-2d.ts:105-114`; `raster-tile-layer.ts:493-504`).
- Passing `image: undefined` explicitly causes a black flash ([#376]) (`raster-tile-layer.ts:817-819`).
- The `MosaicTileset2D` index needs `x/y/z: 0` until deck.gl#10299 ships (`mosaic-tileset-2d.ts:189-193`).

**TODOs with issue numbers:**
- Upload per-band textures directly instead of interleaving on the CPU ([#772]) (`render-pipeline.ts:192`).
- JPEG tiles go through a GPU-to-CPU copy ([#228], see 3.1).
- Tile-offset lookups ignore the caller's abort signal ([#690], see 3.1).

**Zarr:**
- Dimensions must be named, and y must come before x ("needs a transpose, which is not implemented").
- `proj:code` must be EPSG (`zarr-source.ts:363-371`).
- No decode workers and no range merging (see 3.3 and 3.8).

### 7.1 Maturity and API churn

- Pre-1.0: current release `v0.10.0-beta.4 - 2026-11-06` (`CHANGELOG.md:3`). Breaking (`!`) changes in the 0.10 betas: `DEFAULT_RANGE_READER` moved to `@developmentseed/deck.gl-raster` ([#837], `CHANGELOG.md:9`); `ZarrSource` opens from store + `path` ([#838], `:10`); `maxCacheByteSize` removed from `MosaicLayer` ([#843], `:34`); `COGLayer` takes `COGSource` ([#799], `:55`); `MultiCOGSource` ([#801], `:56`); `MosaicLayer` items as `data` ([#804], `:58`); `ZarrSource` ([#812], `:62`); geotiff reads through the range reader ([#807], `:64`); `renderSource` no signal ([#821], `:70`). 0.9: `CutlineBbox` removed for deck.gl `ClipExtension` ([#739], `:117`); JPEG tables in cached tags ([#769], `:95`).
- The v0.10 release post (a draft at the time; published in [#869]) summarizes upgrades: `COGLayer` `geotiff` -> `source`, `epsgResolver`/`concurrencyLimiter` -> `COGSource.open` options, `onGeoTIFFLoad` -> `onSourceLoad`; `MultiCOGLayer` `sources` -> `source`; `MosaicLayer` `sources` -> `data`, `MosaicSource` -> `MosaicItem`; `ZarrLayer` `node`/`metadata` -> `source`; `GeoTIFF.fromUrl` `chunkSize`/`cacheSize` removed (`docs/blog/v0.10-release.md`).
- "The `ZarrLayer` API may change a bit in the future" (`docs/blog/initial-geozarr.md:45`).

### 7.2 Experimental features and examples

- Experimental examples are LLM-written and not reviewed; explainers likewise (`examples/README.md:11-28`; `docs/blog/v0.9-release.md:39-43`).
- Custom projections: preview only until deck.gl v10 ships `_CustomProjectionView` (`examples/experimental/custom-projection/README.md:8-14`; `docs/blog/v0.9-release.md:45-55`). Stated limits: top-down camera only, no pitch/bearing, no `maxBounds`; `fromCrs` must be WGS84 lng/lat; pole-containing rasters only render in their own polar projection; tiles crossing the projection domain edge are trimmed exactly only for parallel-row grids (EPSG:4326, Web Mercator), others clamped (mesh folds, reprojector hits its iteration cap); geographic grids stop 0.5° short of each pole (~110 km hole); non-lng/lat-box domains (e.g. one orthographic hemisphere) not handled; switching projection refetches tiles (`examples/experimental/custom-projection/README.md:25-48`).
- Terrain draping relies on deck.gl's experimental `_TerrainExtension` (`examples/experimental/cog-terrain/README.md:3-4, 30-34`). Stated limits: terrain tiles set the drape resolution (max 2048 px texture, about z17 cap with Terrain Tiles); **"Tilted views load tiles at the center's resolution out to the horizon. `COGLayer` picks every tile's resolution for the zoom at the center of the view"** (a 65° tilt loads ~250 tiles at z15, >2,000 at z17); no terrain means no COG; up to 16 MB GPU texture per terrain tile (~390 MB seen) and deck.gl 9.4 doesn't free them; terrain lighting darkens the COG; one view only; "Picking the draped COG itself is untested"; "Draping in MapLibre's interleaved mode is untested" (`examples/experimental/cog-terrain/README.md:125-178`).
- `MultiCOGLayer` signed integer and float bands: "(experimental)" ([#777], `CHANGELOG.md:102`).
- Output-pixel mesh error mode `_errorSpace` is experimental ([#711], `CHANGELOG.md:154`; `examples/explainers/reprojection-explainer/README.md:30-45`).
- GlobeView support is "preliminary"; fixed resampling points, possible distortion (`docs/blog/v0.8-release.md:20-31`).
- PMTiles via `RasterTileLayer`: "provisional"; `RasterTileLayer` doesn't take a `source`, and the subclass exists only to enable the protected `_abortUnwantedLoads` hook "until a public prop does" (`examples/experimental/pmtiles-terrain/README.md:131-138`).

### 7.3 Data types, formats and pipelines

- `COGLayer`'s default pipeline does not render Float32: "The elevation is Float32, which the COG layer's default pipeline doesn't render, so the example brings its own `getTileData` and `renderTile`" (`examples/vrt-mosaic/README.md:13`); "The COG layer's default pipeline only handles unsigned integers, so float data needs its own `getTileData` and `renderTile`" (`examples/vrt-mosaic/src/elevation.ts:38-39`). Verified in the code: see 2.3 and 2.5.
- `r32float` textures need `OES_texture_float_linear` for linear filtering, so examples use `nearest` (`examples/vrt-mosaic/src/elevation.ts:63-69`).
- 16-bit images in Firefox fixed only in 0.9 (Firefox lacks the WebGL2 norm16 extension) (`docs/blog/v0.9-release.md:137`).
- JPEG and WebP decoding are browser-only (`packages/geotiff/README.md:11`). Supported compressions: Deflate, LERC, LERC+Deflate, LERC+ZSTD, LZW, JPEG, WebP, ZSTD, plus user-defined decoders (`packages/geotiff/README.md:10-12, 166-187`).
- "If you have an image where the CRS fails to parse, please create an issue" (`packages/geotiff/README.md:136`).
- Zarr: assumes GeoZarr metadata; CF-convention inference is future work (`docs/blog/initial-geozarr.md:36`); spatial dims may be anywhere "as long as y comes before x" (`packages/deck.gl-zarr/README.md:80`); chunking over non-spatial dims is future ([#457]) (`docs/blog/initial-geozarr.md:53-55`); Zarr reads don't go through the range reader yet ([#855]) (`packages/range-reader/README.md:116-122`).
- `MosaicLayer` "doesn't draw overlapping items in a set order" (GDAL draws later sources on top) (`examples/vrt-mosaic/README.md:15`).
- Web Mercator view clamps data beyond +/-85.05° (`docs/blog/2026-03-20-v0.4-release.md:67`; fix for positioning in `docs/blog/v0.8-release.md:49-63`).
- titiler example: only `uint8` RGB tiles and only `WebMercatorQuad` (`examples/experimental/titiler-cog/README.md:47-51`).
- Browsers that randomize canvas reads and lack `VideoFrame` (Firefox `privacy.resistFingerprinting`) can't decode PMTiles elevation exactly (`examples/experimental/pmtiles-terrain/README.md:109-112`).
- `@developmentseed/affine` is "not yet a full port" of rasterio/affine (`docs/blog/2026-03-18-v0.3-release.md:153`).

### 7.4 Gaps (absent from docs)

- No narrative guide beyond `intro.md`: no tutorial, no install section, no CRS guide, no colormap/pipeline guide, no CORS guide (tracked `docs/guides/` holds only `intro.md`).
- No doc or example reads raster pixel values (picking/hover readout). The only `pickable` layers in examples are the GeoArrow points (`examples/experimental/geoarrow-overlay/src/App.tsx:151`) and the `TerrainLayer` for `TerrainController` (`examples/experimental/cog-terrain/src/App.tsx:389`); `custom-projection` reports cursor lng/lat only (`src/App.tsx:252-259`).
- No bundler guidance except Vite.

### 7.5 Doc drift and inconsistencies (possibly stale statements)

- `docs/guides/intro.md:23` lists "_Soon_: color correction, spectral band math, pixel filtering", while the homepage advertises band math (`docs/src/components/HomepageFeatures/index.tsx:54`) and two examples do NDVI with GPU filtering (5.3).
- `docs/guides/intro.md:32` footnote "The raster reprojection has not been tested on polar projections", while `custom-projection` ships EPSG:3413/3031 presets (`examples/experimental/custom-projection/src/projections.ts:35-56`).
- `examples/experimental/cog-terrain/README.md:116-117` says the default pipeline "would draw the fourth band as alpha" for NAIP, but `docs/blog/v0.9-release.md:140` says the default pipeline now uses the real alpha band "rather than assuming the 4th band is an alpha band" ([#732]). The code matches the blog: the 4th band is alpha only when `ExtraSamples` says so, else `Opaque` is applied (`render-pipeline.ts:271-294`; `packages/geotiff/src/colorinterp.ts:77-91`), so the cog-terrain README is stale.
- `docs/docusaurus.config.ts:7-12` says the generated API markdown "is committed", but `docs/.gitignore:1` ignores `api/*` and `docs/README.md:20` says it's regenerated each build.
- `examples/README.md:30-38` run steps omit submodule init and `pnpm build`, which `DEVELOP.md:10-18` and per-example READMEs require (package `exports` point at `dist/`).
- `examples/cog-basic/README.md:9-18` describes NZ EPSG:2193 imagery as the data; the app defaults to Sentinel-2 NYC with 11 choices (`examples/cog-basic/src/App.tsx:70-155`).
- `examples/vermont-cog-comparison/README.md:3` calls itself "The first pure-deck.gl (no maplibre) example", but the app renders in `MaplibreMap` with an interleaved overlay (`src/App.tsx:456-479`).
- `examples/zarr-sentinel2-tci/README.md:17` tells the reader to `cd examples/cog-basic`.
- `packages/deck.gl-zarr/README.md:3, 7, 81` says Zarr is reprojected "to Web Mercator", while `zarr-globe` renders a `ZarrLayer` on a globe.
- `examples/naip-mosaic/src/App.tsx:32` imports `GetTileDataOptions` from `../../../packages/deck.gl-geotiff/dist/cog-layer.js`, though it is exported from the package root (`packages/deck.gl-geotiff/src/index.ts:1-4`).
- `packages/deck.gl-raster/GPU_MODULES.md:3` says pipelines are passed "to the `renderPipeline` prop on `RasterLayer` or `RasterTileLayer`"; `RasterTileLayer` has no such prop: pipelines come from `renderTile` (`packages/deck.gl-raster/src/raster-tile-layer/raster-tile-layer.ts:121-131`). `MultiCOGLayer` does have a `renderPipeline` prop.

[#228]: https://github.com/developmentseed/deck.gl-raster/issues/228
[#376]: https://github.com/developmentseed/deck.gl-raster/issues/376
[#457]: https://github.com/developmentseed/deck.gl-raster/issues/457
[#562]: https://github.com/developmentseed/deck.gl-raster/issues/562
[#690]: https://github.com/developmentseed/deck.gl-raster/issues/690
[#711]: https://github.com/developmentseed/deck.gl-raster/issues/711
[#732]: https://github.com/developmentseed/deck.gl-raster/issues/732
[#739]: https://github.com/developmentseed/deck.gl-raster/issues/739
[#769]: https://github.com/developmentseed/deck.gl-raster/issues/769
[#772]: https://github.com/developmentseed/deck.gl-raster/issues/772
[#777]: https://github.com/developmentseed/deck.gl-raster/issues/777
[#791]: https://github.com/developmentseed/deck.gl-raster/issues/791
[#799]: https://github.com/developmentseed/deck.gl-raster/issues/799
[#801]: https://github.com/developmentseed/deck.gl-raster/issues/801
[#803]: https://github.com/developmentseed/deck.gl-raster/issues/803
[#804]: https://github.com/developmentseed/deck.gl-raster/issues/804
[#807]: https://github.com/developmentseed/deck.gl-raster/issues/807
[#812]: https://github.com/developmentseed/deck.gl-raster/issues/812
[#816]: https://github.com/developmentseed/deck.gl-raster/issues/816
[#818]: https://github.com/developmentseed/deck.gl-raster/issues/818
[#821]: https://github.com/developmentseed/deck.gl-raster/issues/821
[#837]: https://github.com/developmentseed/deck.gl-raster/issues/837
[#838]: https://github.com/developmentseed/deck.gl-raster/issues/838
[#843]: https://github.com/developmentseed/deck.gl-raster/issues/843
[#855]: https://github.com/developmentseed/deck.gl-raster/issues/855
[#869]: https://github.com/developmentseed/deck.gl-raster/issues/869
