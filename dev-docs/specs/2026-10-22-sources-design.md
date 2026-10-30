# Sources: Opened Data That Layers Share

- **Date:** 2026-10-22
- **Issues:** background: [#770](https://github.com/developmentseed/deck.gl-raster/pull/770) (the load race this design removes), [#723](https://github.com/developmentseed/deck.gl-raster/issues/723) (checks for the files of one scene), [#709](https://github.com/developmentseed/deck.gl-raster/pull/709) (our cache middleware; refcounted cancellation is its open follow-up)
- **Status:** Accepted for v0.10; stages land one PR at a time

Code links are pinned to main at
[`06368340`](https://github.com/developmentseed/deck.gl-raster/commit/0636834044bd9049a1a79a4e33f25a5bdda3ce90).

## Problem

Each layer opens its own data inside its deck.gl lifecycle. When its input
prop changes, `updateState` starts an async load and copies the result into
layer state:

- `COGLayer` ([`_parseGeoTIFF`](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-geotiff/src/cog-layer.ts#L222))
  opens the file (unless it was given a `GeoTIFF`), resolves its CRS with
  `epsgResolver`, builds the projection functions and the tile grid, then
  calls `onGeoTIFFLoad`.
- `MultiCOGLayer` ([`_parseAllSources`](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-geotiff/src/multi-cog-layer.ts#L455))
  does the same for every file in `sources`, using the first file's CRS for
  all of them.
- `ZarrLayer` ([`_parseZarr`](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-zarr/src/zarr-layer.ts#L213))
  opens the arrays of every level, parses the GeoZarr metadata, checks the
  dimensions, resolves the CRS and builds the tile grid.

This causes four problems:

1. **Async work in `updateState` races.** deck.gl hands each new layer instance
   the old instance's `state` object, and a load still running on the old
   instance writes into it. #770 fixed this for COGLayer and MultiCOGLayer with
   a per-load `AbortController`. ZarrLayer still has the race, and each layer
   repeats the same loading, abort and error bookkeeping.
2. **State about a dataset lives on a layer.** Two layers on one COG open it
   twice. A layer that's removed and re-added opens it again. The app only sees
   the metadata through `onGeoTIFFLoad`. Two examples build their own caches to
   get around this:
   [naip-mosaic](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/examples/naip-mosaic/src/App.tsx#L74-L93)
   keeps a module-level `Map<url, Promise<GeoTIFF>>`. Its comment notes that a
   library version would need refcounted cancellation.
   [vermont-cog-comparison](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/examples/vermont-cog-comparison/src/App.tsx#L318-L352)
   keeps one `GeoTIFF` per URL in React state.
3. **Data settings are layer props.** `epsgResolver` is a prop on COGLayer,
   MultiCOGLayer and ZarrLayer, and `concurrencyLimiter` on COGLayer and
   MultiCOGLayer. Each layer also takes its own input shape: `geotiff` (a
   `GeoTIFF`, string, `URL` or `ArrayBuffer`), MultiCOGLayer's `sources`
   config, and ZarrLayer's `node`, `variable` and `metadata`.
4. **The files of one scene need their own layer.** Bands stored as separate
   files need `MultiCOGLayer`, which has props of its own and doesn't check that
   its files actually form one scene (#723). A mosaic of such scenes would need
   MosaicLayer returning a MultiCOGLayer for each item.

## Prior art

**OpenLayers** (read at
[`73c527cd`](https://github.com/openlayers/openlayers/commit/73c527cd47863d526fee5e50ccec9831082e61b7)):

- **Sources:** the app creates a source, and the source opens its data itself.
- **Layers:** a layer listens to exactly one source, and the renderer skips
  the layer until that source is ready
  ([`Layer.js#L250-L272`](https://github.com/openlayers/openlayers/blob/73c527cd47863d526fee5e50ccec9831082e61b7/src/ol/layer/Layer.js#L250-L272),
  [`Composite.js#L149-L155`](https://github.com/openlayers/openlayers/blob/73c527cd47863d526fee5e50ccec9831082e61b7/src/ol/renderer/Composite.js#L149-L155)).
  Layers never copy the source's results, so they can't have our race.
- **Caches:** tile caches live in each layer's renderer. The source keeps only
  file-level state: headers, byte caches and opened arrays.
- **Bands:** one GeoTIFF source accepts several URLs as the bands of one image,
  and checks that they agree
  ([`GeoTIFF.js#L762-L831`](https://github.com/openlayers/openlayers/blob/73c527cd47863d526fee5e50ccec9831082e61b7/src/ol/source/GeoTIFF.js#L762-L831)).
- **Cancellation is weak.** An open can't be cancelled, and the WebGL renderer
  effectively never aborts tile reads that have started.

**deck.gl:** `WMSLayer` takes `data: string | ImageSource`. It turns a URL into a
source it makes itself, or uses a source the app already made. loaders.gl 4.4
has a `TileSource` interface (`getMetadata()`, `getTileData({signal})`). Its
metadata assumes a standard XYZ pyramid, so it doesn't fit our grids.

**Where we differ from OpenLayers:** our source is an *opened* handle from an
async factory, not an object that loads itself. A layer never sees a source
that is still loading.

## Decided

These were settled in the #770 discussion on 2026-10-22:

1. **A source is an instance holding opened handles**, created by an async
   factory (`COGSource.open(...)`). Layers that need the same data share the
   instance. While it's still opening, they share the promise.
2. **Layers take an opened source** and derive everything from it
   synchronously.
3. **Several files of one scene make up one source.** A mosaic is not a source:
   MosaicLayer keeps its index of `{bbox, id}` items, opens a source only for
   items in view, and never pre-fetches headers. The app states which case it
   means. Nothing is inferred from footprints.
4. **Cancellation must be better than OpenLayers'.** Opens can be aborted, tile
   cancellation keeps working, and a read shared by several consumers is aborted
   only when all of them have aborted.

These were settled on 2026-10-23:

5. **The five stages below land as separate PRs, one at a time.**
6. **The shorthand stays.** `new COGLayer({ geotiff: url })` keeps working and
   stays backwards compatible, so high-level users can pass a URL directly.
   *Amended on 2026-10-26:* there's one prop, `source`, which takes an opened
   source or the shorthand inputs (`new COGLayer({ source: url })`). `geotiff`
   is removed.
7. **The source holds texture format metadata** (see the table below).
   *Deferred on 2026-10-26; see decision 14.*
8. **No library source cache for now.**
9. **Deferred to the stage that needs them:** decisions about the old props,
   and about the proposals marked in this document.

These were settled on 2026-10-26, for stage 2:

10. **A `RasterSource` base class** in deck.gl-raster holds what every format
    shares: the tile grid (`tilesetDescriptor`) and the geographic bounds.
    `COGSource` extends it, and `ZarrSource` will (answers Q5).
11. **A clean break** (answers Q3). COGLayer's `epsgResolver`,
    `concurrencyLimiter` and `onGeoTIFFLoad` are removed, not deprecated. The
    shorthand takes no options: to change how a COG opens, call
    `COGSource.open` and pass `source`.
12. **`onSourceLoad(source)`** replaces the per-format load callbacks
    (`onGeoTIFFLoad`, and a future `onZarrLoad`). A layer calls it only when it
    opens its own source, from shorthand input.
13. **Stage 2 lands as two PRs:** 2a for sources of one file (`COGSource`),
    and 2b for sources of several files (`MultiCOGSource`, question 8). In
    both, the layer takes a single `source` prop: COGLayer in 2a, MultiCOGLayer
    in 2b (see Stages).
14. **Texture formats are deferred** (amends decision 7):
    - A COG's own tags give no texture format for 3-band files or for files
      with more than 4 bands, which render today: the default pipeline adds
      an alpha band, and custom pipelines handle the rest. So `open` can't
      reject them.
    - COGLayer's default pipeline uploads all of a file's bands as one
      texture, while MultiCOGLayer uploads each band as its own one-channel
      texture and turns integers into `r32float`. A format on the source would
      fit only one of them.
    - Revisit with a revamp of how shaders read textures.

These were settled on 2026-10-26, for stage 3:

15. **MosaicLayer's items are `data`** (answers question 7, as built). The
    items come in through deck.gl's async `data` prop, so a URL with
    `dataTransform` can load a STAC search, and `isLoaded` waits for it. The
    callbacks get the opened source as `{ source }`, `onViewportLoad`'s
    entries are `{ item, source }`, and `MosaicSource` is `MosaicItem`. The
    source type stays unconstrained, so a mosaic of plain images still works.
16. **naip-mosaic keeps its own source cache.** MosaicLayer's cache can't hold
    sources cheaply yet. deck.gl's TileLayer keeps the sublayers of every
    cached tile, out of view ones included, and a COGLayer out of view keeps
    all its tiles, since a tileset evicts only after it adds a tile. So
    naip-mosaic turns MosaicLayer's cache off (`maxCacheSize: 0`) and keeps
    the opened sources itself. *Proposal, for its own PR:* MosaicLayer
    creates sublayers only for items in view, so its cache holds only
    sources.
17. **`maxCacheByteSize` doesn't bound MosaicLayer's cache**
    ([#803](https://github.com/developmentseed/deck.gl-raster/issues/803)):
    its tiles report no `byteLength`, so deck.gl's byte count becomes NaN. It
    gets fixed with decision 16's proposal, once sources report an
    approximate `byteLength`.

These were settled on 2026-10-26, for stage 4:

18. **Stage 4 lands as three PRs:** 4a, `RasterTileLayer` handles `source` for
    every layer; 4b, `ZarrSource` and ZarrLayer's `source`; 4c, ZarrLayer
    fetches its tiles again when `selection` changes (see Stages).
19. **`RasterTileLayer` handles `source`** (answers question 5, as built in
    4a). It tells an opened source from other input with
    `instanceof RasterSource`:
    - It draws an opened source at once, and aborts any open in flight.
    - It opens other input in `loadMetadata`, through the layer's
      `_openSource(input, signal)`. It drops the result if `source` changed
      meanwhile, and otherwise calls `onSourceLoad`.
    - It keeps the source in `state.source`, and takes the tile grid from it.
    - A layer's `_sourceState(source)` returns more state to keep with a
      source, such as COGLayer's default pipeline. If it throws, the layer
      reports the error through `onError` and draws nothing rather than the
      old source. The error doesn't escape `updateState`: deck.gl then skips
      `renderLayers`, which kept the old source drawn after 2a.
    - `undefined` and `null` both mean no source.
    - Two type parameters type all of this: `SourceT`, the opened source a
      layer draws, and `InputT`, the input it opens. They default to the two
      parts of the layer's `source` prop, so COGLayer's
      `source: COGSource | COGInput` gives `COGSource` and `COGInput`, and a
      layer passes neither. The base reads `source` and `onSourceLoad`
      without casts.
20. **Each layer declares its own `source` and `onSourceLoad`** (answers
    question 6). Each layer's `source` takes its own inputs, and its
    declaration documents them. `RasterTileLayer` adds the same two props,
    typed by `SourceT` and `InputT`, to every layer's props.
21. **ZarrLayer takes one `source`** (decisions 6 and 11, for 4b): a
    `ZarrSource`, or a zarrita group or array to open with the defaults.
    `node`, `variable`, `metadata` and `epsgResolver` are removed from
    ZarrLayer: `node` becomes `ZarrSource.open`'s first argument, and the
    others its options, with `metadata` renamed `geoZarrMetadata`
    (question 9). Stage 4's first draft kept the old props
    as shorthand, from before decision 6's amendment.
22. **`selection` stays on ZarrLayer.** The source is the whole Zarr object,
    while the layer decides which chunks to load from it. The layer checks
    `selection` against the source's dimensions whenever either changes, so
    two layers can draw different selections of one source.
23. **What `ZarrSource` holds:** one opened array per level, finest first;
    every dimension name, and the names of the y and x dimensions; the
    projection; the tile grid; and geographic bounds, which ZarrLayer never
    had. It doesn't keep the parsed GeoZarr metadata (question 9). The
    bounds are computed as COGSource's are: from the finest level's corners,
    the short way across the antimeridian. That calculation and
    `projectionFunctions` move to `@developmentseed/proj`, so both formats
    share them.

This was settled on 2026-10-28, for 4c:

24. **A refetch replaces the inner TileLayer.**
    - **The mechanism:** `RasterTileLayer` counts refetches, and puts the
      count in its inner TileLayer's id. deck.gl removes the old TileLayer at
      once, and its tileset aborts the loads in flight and unloads every tile
      ([#728](https://github.com/developmentseed/deck.gl-raster/pull/728)).
    - **What refetches:** a change to `updateTriggers.getTileData` or
      `updateTriggers.all`, and a change to ZarrLayer's `selection`, compared
      by value.
    - **The old tiles go at once.** The map shows nothing where new tiles
      haven't loaded yet. Kyle chose this over keeping the old tiles drawn:
      they would show stale data after the controls show the new selection.
    - **deck.gl's own reload, `Tileset2D.reloadAll`, isn't used.** In 9.4 it
      keeps drawing old tiles: the tiles it drops stay in `tileset.tiles`,
      still marked visible. It also drops or replaces their data without
      `onTileUnload`, so their textures would leak.

This was settled on 2026-10-29, replacing stage 5's plan:

25. **One layer per source class.** COGLayer draws a `COGSource`,
    MultiCOGLayer a `MultiCOGSource`, and ZarrLayer a `ZarrSource`, so each
    layer's props, `onSourceLoad` and tile data have exact types.
    - **Why not one COG layer:** TypeScript can't pick props by what `source`
      holds. One layer for both COG classes would need a union for
      `onSourceLoad`, props that apply to one kind of source only, and tile
      callbacks typed for the wrong data.
    - **Mosaics:** `renderSource` returns the layer for each item's source,
      as it already can.

## Goals

- `COGSource` (one file), `MultiCOGSource` (several files of one scene) and
  `ZarrSource`. Each holds the dataset state that costs I/O or async work to
  get: opened handles, the projection, the tile grid, geographic bounds and
  band metadata.
- Layers take a `source` prop, and nothing on that path awaits anything.
- One source can back several layers, several `Deck`s and successive lifetimes
  of a layer, without reading headers or resolving the CRS again.
- MosaicLayer's `getSource` returns sources, opened only for items in view.
- A source made of several files checks them and rejects a mismatch (#723).
- Settings about the data move from layer props to `open()` options.
- ZarrLayer's copy of the #770 race is fixed.

## Non-goals

- **Sharing tile data across layers.** Two layers on one source still fetch,
  decode and upload their own tiles, as in OpenLayers. Sharing at the tile level
  needs refcounted cancellation and is follow-up work.
- Changes to tile selection, traversal or `RasterTilesetDescriptor`.
- New formats, a React hook, and the Sentinel-2 mosaic demo. The demo comes
  after stage 5.

## Anti-goals

- MosaicLayer opening every item's header up front.
- Telling a scene from a mosaic by its footprints.
- Async loading returning to a layer's source path, which would bring back the
  #770 race.
- Sources that leak if the app forgets to call a cleanup method.

## Constraints

- **Stable identity:** deck.gl compares props by identity, so an app must keep
  its source object stable across renders. Opening a new source on every render
  reloads on every render, as with any object prop.
- **Performance** is a top priority. No requests beyond today's. The `GeoTIFF`
  header byte cache and the per-origin request limiter apply to opens as well
  as to tiles.
- **Breaking changes** are allowed before 1.0, with migration notes.
- **Packages:** `COGSource` needs `@developmentseed/geotiff`,
  `@developmentseed/proj` and deck.gl-raster's tile grid types, so it lives in
  `@developmentseed/deck.gl-geotiff`. `ZarrSource` lives in
  `@developmentseed/deck.gl-zarr`.
- **Repo conventions:** options objects instead of long positional arguments,
  JSDoc on everything public, and minimal exports.

## Design

### What lives on a source, and what stays on a layer

| Source: the data, shared | Layer: rendering, per layer |
| --- | --- |
| Opened handles: `GeoTIFF`s, Zarr arrays per level | Render pipeline: the inferred default needs a device; or `getTileData`/`renderTile` |
| Projection definition and converters | `composite`, `renderPipeline`, `resampling` |
| Tile grid: `RasterTilesetDescriptor`, or the multi-file grouping | Tile cache and GPU textures (deck.gl's TileLayer) |
| Geographic bounds | `debug`, `opacity`, picking and other layer props |
| Band metadata: names, count, dtype, nodata, color interpretation, stats | Zarr `selection`: which slice to draw |
| *Deferred (decision 14):* texture format of each file, inferred once from its tags ([`inferTextureFormat`](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-geotiff/src/geotiff/texture.ts#L38)). A layout that isn't supported fails at open, not on every tile. | What the device supports: the 16-bit normalized to 32-bit float fallback ([`resolveTextureFormat`](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-geotiff/src/geotiff/texture.ts#L219)) and linear filtering ([`isFilterable`](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-geotiff/src/geotiff/texture.ts#L242)) |
| I/O settings fixed at open: limiter, priority, EPSG resolver | Decoder `pool`, passed per tile fetch (proposal) |

### `COGSource`

As built, with these names: a `COGSource` for one file (2a), and a
`MultiCOGSource` for the files of one scene (2b, question 8).

```ts
type COGInput = string | URL | ArrayBuffer | GeoTIFF;

type COGSourceOptions = {
  /** Aborts the open: pending header reads are cancelled and `open` rejects. */
  signal?: AbortSignal;
  /** Defaults to the shared resolver from `@developmentseed/proj`. */
  epsgResolver?: EpsgResolver;
  /** Defaults to `DEFAULT_CONCURRENCY_LIMITER`. Ignored for a pre-opened `GeoTIFF`. */
  concurrencyLimiter?: ConcurrencyLimiter | null;
  /** Priority of this source's queued reads. MosaicLayer passes one. */
  getPriority?: () => Priority;
};

class COGSource extends RasterSource {
  static open(input: COGInput, options?: COGSourceOptions): Promise<COGSource>;

  /** The opened file. */
  readonly geotiff: GeoTIFF;
  /** The file's CRS, resolved once. */
  readonly projection: ProjectionDefinition;
  // From RasterSource:
  /** WGS84 bounds, going the short way across the antimeridian. */
  readonly geographicBounds: GeographicBounds;
  /** The tile grid: the file's pyramid. */
  readonly tilesetDescriptor: RasterTilesetDescriptor;
}

/** The files of one scene, by name (2b). */
class MultiCOGSource extends RasterSource {
  static open(inputs: Record<string, COGInput>, options?: COGSourceOptions): Promise<MultiCOGSource>;

  /** The opened files, by name, in the record's key order. */
  readonly geotiffs: ReadonlyMap<string, GeoTIFF>;
  /** The CRS that every file shares, resolved once. */
  readonly projection: ProjectionDefinition;
  /** Every file's tile grid, with the finest file's grid as primary. */
  readonly multiTilesetDescriptor: MultiRasterTilesetDescriptor;
  // From RasterSource: the primary's tile grid and geographic bounds
}
```

`open()` does what the layers' parse methods do today, once:

1. Open the files in parallel.
2. Check the files, if there are several.
3. Resolve the CRS, once.
4. Build the projection functions and the tile grid.
5. Compute the geographic bounds.

Fetches get the signal. Steps that don't fetch, such as awaiting the EPSG
resolver, check `signal.aborted` afterwards. Failures reject with an error that
names the file. On the source path no load happens inside a layer, so the app
handles these rejections. (On the shorthand path the layer still reports them
through `onError`, as today.)

**A bare input versus a record.** A bare input is one file, opened as a
`COGSource` and drawn by COGLayer. A record means bands addressed by name,
opened as a `MultiCOGSource` and drawn by MultiCOGLayer's band compositing
(`composite` refers to the record's keys), even if it has only one entry. The
class states the intent, so the file count never decides how something renders
(decision 25).

### The files of one scene

`MultiCOGSource.open` checks the files after opening them, before resolving
their CRS. It compares each file with the first one, and rejects with an error
naming both files and the mismatch. These rules are as built in 2b.

- **Same CRS:** the `crs` values must be identical: EPSG codes by number, and
  WKT and PROJJSON by value. The comparison is strict, since the files of one
  product carry the same encoding, so a CRS given as an EPSG code in one file
  and as WKT in another is rejected.
- **Same extent:** each bounding box edge must be within one pixel of the
  coarser of the two files. A pixel's size is the longer side of a pixel in the
  file's transform. This answers #723's open question.
  - Bands at different resolutions may not end on exactly the same edge, but
    one coarse pixel covers that. Sentinel-2's 10, 20 and 60 m bands of one
    tile share an extent exactly.
  - A larger difference usually means the files are a mosaic, not one scene.
- **Resolution:** no constraint. The secondary-level selection already handles
  any ratio.
- **A file that fails to open** is named: `Failed to open "nir" (<url>):
  <reason>`, with the original error as its `cause`. An abort stays a plain
  `AbortError`.

### Layers

```ts
const source = await COGSource.open(url);
fitBounds(source.geographicBounds);          // no onGeoTIFFLoad needed
new COGLayer({ id: "cog", source });
new COGLayer({ id: "overview", source });    // e.g. an overview map's Deck: same opened data
```

When `source` is an opened source, the layer derives its state synchronously.
`RasterTileLayer.updateState` stores the source in state, with whatever the
layer's `_sourceState` derives from it, such as COGLayer's default pipeline,
and aborts any open still in flight (decision 19). Each layer only says how to
open its other inputs:

```ts
// The source types come from COGLayerProps' `source: COGSource | COGInput`
class COGLayer extends RasterTileLayer<DataT, COGLayerProps<DataT>> {
  protected override _openSource(input: COGInput, signal: AbortSignal) {
    return COGSource.open(input, { signal });
  }
}
```

Nothing is awaited, so nothing can arrive late, and `isLoaded` has no metadata
step on this path.

**A new tile grid needs a new inner TileLayer.** deck.gl's TileLayer builds its
tileset, and with it the tile grid, once, on its first update. A new
`TilesetClass` doesn't replace it, and its options can't carry our descriptor.
Today's layers reload by rendering nothing for a frame, which removes the
TileLayer. A new opened source switches without that gap. So `RasterTileLayer`
names its inner TileLayer after the descriptor object, and a new descriptor
gets a new TileLayer. Without that, the layer would keep drawing the old
source's tiles on the old grid. Refetching tiles on the same grid gets a new
TileLayer too (decision 24).

**Shorthand (decision 6).** `new COGLayer({ source: url })` opens a private
source in `loadMetadata` (stage 1). It calls the same `COGSource.open`, so the
two paths can't drift apart, and stores the result in the same `state.source`.
The open uses the layer's own load signal, which aborts when `source` changes
or the layer is removed. The layer's `signal` prop stays for tile loads only:
if it also aborted the open, the abort would reach `onError` while the layer is
still alive. MosaicLayer removes a layer when its item leaves the cache, which
aborts its open anyway.

### `ZarrSource`

```ts
const source = await ZarrSource.open(group, { variable: "temperature", signal });
new ZarrLayer({ id: "zarr", source, selection: { time: t }, getTileData, renderTile });
```

- **Input:** a zarrita `Group` or `Array`. The caller still owns the store, as
  today. ZarrLayer's `source` also takes one, as shorthand opened with the
  defaults (decision 21).
- **Holds:** the arrays of each level (finest first), the dimension names,
  the spatial dimensions, the projection, the tile grid and the geographic
  bounds (decision 23).
- **Options:** `variable`, the `metadata` override, renamed `geoZarrMetadata`,
  and `epsgResolver` move from the layer to `open()` options.
- **Checks:** `open` rejects what ZarrLayer's load rejects today, except the
  selection: unnamed axes or array dimensions, spatial dimensions that aren't
  last in y, x order, and a CRS that doesn't resolve.
- **Stays on the layer:** `selection`, checked against the source's dimensions
  synchronously whenever it or the source changes (decision 22).
- **Refetching (4c):** ZarrLayer fetches its tiles again when `selection`
  changes, compared by value (decision 24).
  - The old tiles go at once, so the map shows nothing where new tiles haven't
    loaded yet, rather than the old selection's data.
  - Apps no longer pass `updateTriggers: { renderTile: [selection] }`
    ([today's note](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-zarr/src/zarr-layer.ts#L372)),
    which only redraws the old data.
  - Apps no longer put the selection in the layer `id` either, which started
    a new layer.

### MosaicLayer

MosaicLayer takes its `{bbox, id}` items as `data` (decision 15). Before stage
3 it called them `sources`
([`mosaic-layer.ts#L51`](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-geotiff/src/mosaic-layer/mosaic-layer.ts#L51)).
`getSource` ([L75](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-geotiff/src/mosaic-layer/mosaic-layer.ts#L75))
returns a source for each item in view:

```ts
new MosaicLayer({
  data: items, // {bbox, id}: nothing fetched
  getSource: (item, { signal, concurrencyLimiter, getPriority }) =>
    COGSource.open(item.url, { signal, concurrencyLimiter, getPriority }),
  renderSource: (item, { source, subLayerProps }) =>
    new COGLayer({ ...subLayerProps, id: item.id, source }),
});
```

- `getSource` runs only for items in view. deck.gl aborts its signal when it
  cancels the open: when the layer is removed, or, for an item no longer in
  view, when more than `maxRequests` opens are in flight. Sublayers never
  re-open a file or re-resolve its CRS.
- An opened source lives as long as its item stays in MosaicLayer's cache, and
  so does the layer drawn for it, with all its tiles (decision 16). The tileset
  doesn't count a source's size either: `maxCacheByteSize` leaves the cache
  unbounded (decision 17). *Proposal:* MosaicLayer creates sublayers only for
  items in view, and sources expose an approximate `byteLength`, mostly the
  header byte cache, so `maxCacheByteSize` can bound them.
- A scene stored as one file per band is a record:
  `getSource: (item) => MultiCOGSource.open({ red: ..., nir: ... })`. That's
  the Sentinel-2 mosaic, drawn by MultiCOGLayer (decision 25).

### Sharing

- **Shared:** several layers can take one source instance. They share the
  opened headers, the projection, the tile grid and the header byte cache.
  While the source is opening, they share the promise.
- **Not shared:** tile fetches stay per layer (see Non-goals).

### Cancellation and lifetime

1. **Opening.** Aborting the signal passed to `open()` cancels pending header
   reads, which frees their limiter slots, and rejects with an `AbortError`.
   Whoever creates the promise owns its signal. When a promise is shared, its
   owner decides when to abort: MosaicLayer when deck.gl cancels the item's
   request, an app when the input changes or its view unmounts.
2. **Opened sources hold only memory:** handles, the header cache, the
   projection and the grid. There's no `dispose()`. Dropping the last
   reference frees a source. Verify during implementation that `GeoTIFF`
   instances hold no timers or workers; the decoder pool is shared and global.
3. **Tile reads.** deck.gl's TileLayer aborts requests for tiles that are no
   longer needed, through per-tile signals. Sources must keep passing those
   signals through.
4. **Shared reads.** Any future deduplication, whether of tile reads or of
   opens through a library source cache, makes one underlying request and
   aborts it only when every consumer has aborted. Nothing that deduplicates
   ships without this.

### API changes

| Today | With sources |
| --- | --- |
| `COGLayer({ geotiff })` | `COGLayer({ source })`: `source` takes the same inputs, or a `COGSource` from `COGSource.open(input)` (decision 6). |
| `epsgResolver` on COGLayer, MultiCOGLayer, ZarrLayer | `open()` option. Removed from COGLayer in 2a, from MultiCOGLayer in 2b, and from ZarrLayer in 4b. |
| `concurrencyLimiter` on COGLayer, MultiCOGLayer | `open()` option, removed from COGLayer in 2a and from MultiCOGLayer in 2b. MosaicLayer keeps its prop and forwards it to `getSource`. |
| `onGeoTIFFLoad` | `onSourceLoad(source)` on the shorthand path (COGLayer in 2a, MultiCOGLayer in 2b). With a `source` prop, read `source.geographicBounds` before creating the layer. |
| `MultiCOGLayer({ sources: { red: { url } } })` | `MultiCOGLayer({ source: { red: url } })`, or a `source` from `MultiCOGSource.open({ red: url })` (2b). |
| `MultiCOGSourceConfig` | Removed. A record of inputs replaces it. |
| `MosaicLayer({ sources })` | `MosaicLayer({ data })`: an array, a promise, or a URL with `dataTransform` (stage 3). |
| `{ data }` in `renderSource`, `onSourceLoad` and `onSourceUnload` | `{ source }`, the source `getSource` opened (stage 3). |
| `signal` in `renderSource`'s options | Removed: it couldn't stop a layer's tile requests, and could arrive already aborted. |
| `onViewportLoad` entries `{ source, data }` | `{ item, source }` (stage 3). |
| `MosaicSource` | `MosaicItem` (stage 3). |
| `ZarrLayer({ node, variable, metadata })` | `ZarrLayer({ source })`: a group or array, or a `ZarrSource` from `ZarrSource.open(node, { variable, geoZarrMetadata })` (4b). |
| `updateTriggers: { renderTile: [selection] }`, or the selection in the layer `id`, on ZarrLayer | Not needed: a new `selection` fetches the tiles again (4c). |

## Stages

Each stage is one PR.

1. **Metadata loading in RasterTileLayer.** It only adds overridable methods,
   so it can ship in a 0.9.x release.
   - Subclasses override two public methods, mirroring deck.gl's
     `shouldUpdateState` and `updateState`:
     - `shouldLoadMetadata(params)` returns `true` when a prop the metadata
       depends on has changed.
     - `async loadMetadata(signal)` loads the metadata and stores it in state.
       After its last `await`, it calls `signal.throwIfAborted()` before
       `setState` or callbacks. deck.gl hands every instance the same `state`
       object, so `setState` from the instance that started the load lands
       where the newest instance reads.
   - The base's `updateState` calls `shouldLoadMetadata`, and a protected
     `_loadMetadata()` (like deck.gl's `_update()`) does the bookkeeping. It
     aborts the previous load, owns `loadingMetadata`, reports only the latest
     load's errors, prefixed with the layer's `metadataErrorContext`, and aborts
     in `finalizeState`.
   - Subclasses type their state as `RasterTileLayer<…>["state"] & {…}`, as
     deck.gl's MVTLayer does with TileLayer's.
   - COGLayer, MultiCOGLayer and ZarrLayer move onto it, and drop their own
     `updateState`.
     - That fixes ZarrLayer's race.
     - MultiCOGLayer now runs `super.updateState`, which it skipped.
     - ZarrLayer also passes the signal to zarrita's `open`, so a replaced load
       stops reading.
   - Tests: #770's tests still pass. ZarrLayer gets the same two race tests (old
     load finishing last, old load finishing first), against a real GeoZarr
     store.
2. **`COGSource`**, in two PRs (decision 13).
   - **2a: one file per source.**
     - `RasterSource` in deck.gl-raster, and `COGSource.open(input, options)`
       in deck.gl-geotiff.
     - COGLayer's `source` prop takes an opened `COGSource`, or what `geotiff`
       took (the shorthand), which the layer opens as a private source.
       `geotiff` is removed.
     - The clean break (decision 11), with the examples moved over.
     - Tests: each input type opens. Aborting mid-open rejects, and an
       already-aborted signal makes no request. A layer given a `source` never
       sets `loadingMetadata`. Two layers sharing one source don't open it
       again. A new source gets a new inner TileLayer.
   - **2b: several files per source.**
     - `MultiCOGSource.open(record, options)`, with the checks above (#723).
       Failures name the file.
     - MultiCOGLayer's `source` prop takes an opened `MultiCOGSource`, or a
       record of COGs to open (the shorthand). `sources` and
       its `{ url }` wrapper are removed, its `epsgResolver` and
       `concurrencyLimiter` move to `open()`, and `onGeoTIFFLoad` becomes
       `onSourceLoad`.
     - Tests: mismatched CRS and extents are rejected, and Sentinel-2-like
       10/20/60 m bands pass.
3. **MosaicLayer docs and examples.**
   - `getSource` returns a `COGSource`.
   - The renames of question 7: `sources` becomes `data`, the callbacks'
     `{ data }` becomes `{ source }`, and `MosaicSource` becomes `MosaicItem`.
   - Port naip-mosaic and vermont-cog-comparison, replacing their caches where
     a shared source is enough. *Outcome:* neither cache goes. naip-mosaic's
     can't yet (decision 16), and vermont-cog-comparison's keeps the sources
     the app switches between, which is what an app's own cache is for
     (decision 8).
   - Use `source.geographicBounds` for `fitBounds`. *Done* in 2a and 2b, for
     every example that fits the map.
   - Check the examples in a browser.
4. **`ZarrSource`**, in three PRs (decision 18).
   - **4a: `RasterTileLayer` handles `source`** (decision 19). COGLayer and
     MultiCOGLayer move onto it, and their behavior doesn't change.
     - Tests: the base's handling, with a test layer. The COG layers' tests
       pass as they were.
   - **4b: `ZarrSource`** and ZarrLayer's `source` (decisions 21 to 23),
     in two PRs at Kyle's request.
     - `projectionFunctions` and the bounds calculation move to
       `@developmentseed/proj`
       ([#811](https://github.com/developmentseed/deck.gl-raster/pull/811)).
     - `ZarrSource.open(node, options)` in deck.gl-zarr.
     - ZarrLayer's `source` prop, the clean break, and the examples.
       aef-mosaic, dynamical-zarr-ecmwf and nldas-icechunk pass
       `geoZarrMetadata`, so they call `ZarrSource.open`.
       zarr-sentinel2-tci passes its group.
     - *As built:* a `selection` that doesn't fit the source goes to
       `onError` and draws nothing. Fixing it draws again, and a selection
       change never opens the source again. Selections are compared by
       value, so an inline literal isn't checked again on every render.
     - The `window.*` debug lines in ZarrLayer's load go: they throw where
       `window` is undefined.
     - Tests mirror stage 2, and check `selection` when it changes.
   - **4c: tiles refresh when `selection` changes** (decision 24). *As built:*
     - **`RasterTileLayer._refetchTiles()`** gives the inner TileLayer a new
       id. A change to `updateTriggers.getTileData` or `updateTriggers.all`
       calls it. That closes
       [#797](https://github.com/developmentseed/deck.gl-raster/issues/797)
       for COGLayer, MultiCOGLayer and ZarrLayer; MosaicLayer's part is
       [#816](https://github.com/developmentseed/deck.gl-raster/issues/816).
     - **ZarrLayer** calls it when it checks a new source and selection pair,
       so an inline `{ time: t }` with the same contents fetches nothing.
     - **The old tiles go at once.**
     - **The plan changed.** It was to forward the triggers to the inner
       TileLayer, keep the old tiles drawn until replaced, and patch
       `reloadAll`'s leaks in `RasterTileset2D`. Checking deck.gl 9.4 showed
       that `reloadAll` also keeps drawing the tiles it drops, so 4c doesn't
       use it.
     - **Examples:** aef-mosaic and dynamical-zarr-ecmwf no longer put the
       selection in their layer `id`.
5. **One layer per source class** (decision 25). It replaces the plan for
   COGLayer to take over MultiCOGLayer's band compositing and deprecate it.
   *As built:* `MultiCOGLayerProps` starts from `RasterTileLayerProps`, as
   `COGLayerProps` does, so each prop is declared once, and COGLayer's docs
   point to MultiCOGLayer. The Sentinel-2 mosaic demo follows.

## Open questions

1. **Shorthand.** *Decided:* it stays (decision 6).
2. **A library source cache.** *Decided:* not for now (decision 8). Revisit
   alongside tile-level sharing, which needs the same refcounting.
3. **Moved props.** Deprecate them with warnings for a release, or remove them
   outright, since we're before 1.0? *Decided:* removed outright
   (decision 11).
4. **Timing of stage 5** (COGLayer absorbing MultiCOGLayer): 0.10, or later?
   *Decided (2026-10-29):* COGLayer doesn't absorb MultiCOGLayer; each
   source class keeps its own layer (decision 25).
5. **A generic `RasterSource` base class** in deck.gl-raster, with a subclass
   per format (`COGSource`, `ZarrSource`), instead of unrelated classes. The
   base class would hold what every format shares, such as the tile grid, and
   `RasterTileLayer` could store and read it itself. *Decided:* yes
   (decision 10). In 2a and 2b, COGLayer and MultiCOGLayer each store and read
   their source themselves, and `RasterTileLayer` only gives each tile grid its
   own inner TileLayer. *Proposal:* when ZarrLayer becomes the third layer with
   a source (stage 4), `RasterTileLayer` owns that plumbing, with two hooks per
   layer, such as `isOpenedSource(value)` and `openSource(input, signal)`.
   *Decided (2026-10-26):* it does, from 4a (decision 19).
   `instanceof RasterSource` takes the place of `isOpenedSource`, and the
   hooks are `_openSource` and `_sourceState`.
6. **Where `onSourceLoad` lives.** 2a and 2b declare `source` and
   `onSourceLoad` on each layer's props, COGLayer's and MultiCOGLayer's, since
   each layer's `source` takes its own inputs. *Decided (2026-10-26):* every
   layer keeps declaring its own, ZarrLayer included, and `RasterTileLayer`
   reads them (decision 20).
7. **MosaicLayer's naming.** MosaicLayer calls its items `sources`, and passes
   each to `getSource`, `renderSource` and `onSourceLoad(item, { data })`.
   Once `getSource` returns a `COGSource` (stage 3), "source" would name both
   an item, which only says where a source is, and the source opened for it.
   *Decided (2026-10-26), for stage 3:*
   - The items move to deck.gl's `data` prop. `getSource(item)` stays.
   - The callbacks get the opened source as `{ source }` rather than
     `{ data }`, so "source" always means a `RasterSource`.
   - `MosaicSource` becomes `MosaicItem`.

   COGLayer and ZarrLayer can't take their input as `data`, because deck.gl's
   async `data` would fetch and parse a COG or Zarr URL before the layer saw
   it. A list of items is what `data` is for: a URL plus `dataTransform` can
   load a STAC search result, and `isLoaded` waits for it.
8. **One class or two for files of one scene.** A separate `MultiCOGSource`
   would keep `COGSource.geotiff` a single `GeoTIFF`, rather than one class
   whose fields depend on its input. *Decided (2026-10-26):* two classes.
   `MultiCOGSource` opens a record of files, and `COGSource` stays one file.
9. **Naming ZarrSource's metadata.** The `metadata` option holds raw
   attributes that replace the group's, while the source's field holds the
   parsed GeoZarr metadata. Keep `metadata` for both, call the field
   `geozarr`, or rename the option `attrs`, after the zarrita property it
   replaces? *Decided (2026-10-27):* the option is `geoZarrMetadata`, since
   `attrs` is zarr's own name for a node's attributes. The source doesn't
   keep the parsed metadata: nothing outside `open()` needs it.
10. **A `ServerSource` for tile servers.** The titiler-cog example gives
    `RasterTileLayer` a `tilesetDescriptor` built from a tile server's
    TileMatrixSet, with no source behind it. A `RasterSource` for tile
    servers would let every layer take a `source`, and the
    `tilesetDescriptor` prop could go. *Later* (raised in #805's review).

## Left to the implementer

- **Names and types:**
  - Settled: `tilesetDescriptor` and `geotiff` for one file (2a);
    `MultiCOGSource`, `geotiffs` and `multiTilesetDescriptor` for several
    (2b); `_openSource` and `_sourceState` on `RasterTileLayer` (4a).
- **Code organization:** file layout and error wording. The COG and Zarr
  `open()` code share their projection helpers through
  `@developmentseed/proj` (decision 23).
- **Input normalization:** where it happens. Today's `fetchGeoTIFF` already
  handles strings, `URL`s, `ArrayBuffer`s and `GeoTIFF`s.
