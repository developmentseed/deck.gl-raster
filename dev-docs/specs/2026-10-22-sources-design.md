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
    opens its own source from shorthand props.
13. **Stage 2 lands as two PRs:** 2a for sources of one file, 2b for sources
    of several files (see Stages).
14. **Texture formats are deferred** (amends decision 7):
    - A COG's own tags give no texture format for 3-band files or for files
      with more than 4 bands, which render today: the default pipeline adds
      an alpha band, and custom pipelines handle the rest. So `open` can't
      reject them.
    - COGLayer's default pipeline uploads all of a file's bands as one
      texture, while MultiCOGLayer uploads each band as its own one-channel
      texture and turns integers into `r32float`. A format on the source would
      fit only one of them.
    - Revisit once one pipeline is left (stage 5), or with a revamp of how
      shaders read textures.

## Goals

- `COGSource` (one file, or several files of one scene) and `ZarrSource`. Each
  holds the dataset state that costs I/O or async work to get: opened handles,
  the projection, the tile grid, geographic bounds and band metadata.
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

A sketch. Stage 2a built the one-file case with these names. 2b decides how a
record's files are exposed, e.g. as `files: ReadonlyMap<string, GeoTIFF>`, and
how its tile grid is grouped.

```ts
/** One COG, or several COGs that are the bands of one scene (2b). */
type COGSourceInput = COGInput | Record<string, COGInput>;
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
  static open(input: COGSourceInput, options?: COGSourceOptions): Promise<COGSource>;

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
```

`open()` does what the layers' parse methods do today, once:

1. Open the files in parallel.
2. Resolve each CRS.
3. Check the files, if there are several.
4. Build the projection functions and the tile grid.
5. Compute the geographic bounds.

Fetches get the signal. Steps that don't fetch, such as awaiting the EPSG
resolver, check `signal.aborted` afterwards. Failures reject with an error that
names the file. On the source path no load happens inside a layer, so the app
handles these rejections. (On the shorthand path the layer still reports them
through `onError`, as today.)

**A bare input versus a record (proposal).** A bare input is one file, rendered
by today's COGLayer pipeline. A record input means bands addressed by name,
rendered by band compositing (`composite` refers to the record's keys), even if
it has only one entry. The input's shape states the intent, so the file count
never decides how something renders.

### The files of one scene

For a record input, `open()` checks the files after opening them, and rejects
with an error naming the files and the mismatch.

- **Same CRS:** the `crs` values must be identical. *Proposal:* compare the
  values strictly in v1, since the files of one product carry the same
  encoding.
- **Same extent:** each file's bbox must be within one pixel of the coarser
  file on every edge. *Proposal:* this answers #723's open question. Bands at
  different resolutions may not end on exactly the same edge, but one coarse
  pixel covers that. Sentinel-2's 10, 20 and 60 m bands of one tile share an
  extent exactly. A larger difference usually means the files are a mosaic, not
  one scene.
- **Resolution:** no constraint. The secondary-level selection already handles
  any ratio.

### Layers

```ts
const source = await COGSource.open(url);
fitBounds(source.geographicBounds);          // no onGeoTIFFLoad needed
new COGLayer({ id: "cog", source });
new COGLayer({ id: "overview", source });    // e.g. an overview map's Deck: same opened data
```

On the source path a layer derives its state synchronously. When `source`
changes, `updateState` stores it in state with the default pipeline inferred
from it, and aborts any shorthand open still in flight:

```ts
updateState(params) {
  super.updateState(params);
  const { props, oldProps } = params;
  if (props.source && props.source !== oldProps.source) {
    this._abortMetadataLoad();
    this.setState(this._sourceState(props.source)); // source, pipeline
  }
}
protected _tilesetDescriptor() {
  return this.state.source?.tilesetDescriptor;
}
```

Nothing is awaited, so nothing can arrive late, and `isLoaded` has no metadata
step on this path.

**A new source needs a new inner TileLayer.** deck.gl's TileLayer builds its
tileset, and with it the tile grid, once, on its first update. A new
`TilesetClass` doesn't replace it. Today's layers reload by rendering nothing
for a frame, which removes the TileLayer. A `source` prop switches without that
gap, so COGLayer gives each source its own inner TileLayer id
(`_tileLayerId`). Without that, the layer would keep drawing the old source's
tiles on the old grid.

**Shorthand (decision 6).** `new COGLayer({ geotiff: url })` keeps working
by opening a private source in `loadMetadata` (stage 1). It calls the same
`COGSource.open`, so the two paths can't drift apart, and stores the result in
the same `state.source`. The open uses the layer's own load signal, which
aborts when `geotiff` changes or the layer is removed. The layer's `signal`
prop stays for tile loads only: if it also aborted the open, the abort would
reach `onError` while the layer is still alive. MosaicLayer removes a layer
whose item leaves view, which aborts its open anyway.

### `ZarrSource`

```ts
const source = await ZarrSource.open(group, { variable: "temperature", signal });
new ZarrLayer({ id: "zarr", source, selection: { time: t }, getTileData, renderTile });
```

- **Input:** a zarrita `Group` or `Array`. The caller still owns the store, as
  today.
- **Holds:** the arrays of each level (finest first), the parsed GeoZarr
  metadata, the spatial dimensions, the projection, the tile grid and the
  geographic bounds.
- **Options:** `variable` and the `metadata` override move to `open()` options.
- **Stays on the layer:** `selection`, checked against the source's dimensions
  synchronously whenever it changes.
- **Proposal:** ZarrLayer refreshes its tiles when `selection` changes, so apps
  no longer pass `updateTriggers: { renderTile: [selection] }`
  ([today's note](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-zarr/src/zarr-layer.ts#L372)).

### MosaicLayer

The API doesn't change. `sources` stays a list of `{bbox, id}` items
([`mosaic-layer.ts#L51`](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-geotiff/src/mosaic-layer/mosaic-layer.ts#L51)),
and `getSource` ([L75](https://github.com/developmentseed/deck.gl-raster/blob/0636834044bd9049a1a79a4e33f25a5bdda3ce90/packages/deck.gl-geotiff/src/mosaic-layer/mosaic-layer.ts#L75))
returns a source:

```ts
new MosaicLayer({
  sources: items, // {bbox, id}: nothing fetched
  getSource: (item, { signal, concurrencyLimiter, getPriority }) =>
    COGSource.open(item.url, { signal, concurrencyLimiter, getPriority }),
  renderSource: (item, { data: source }) => new COGLayer({ id: item.id, source }),
});
```

- `getSource` runs only for items in view. Its signal aborts the open if the
  item leaves view first. Sublayers never re-open a file or re-resolve its CRS.
- An opened source lives as long as its item stays in MosaicLayer's cache.
  *Proposal:* sources expose an approximate `byteLength`, mostly the header byte
  cache, so `maxCacheByteSize` can bound them. Verify that MosaicLayer's tileset
  counts it.
- A scene stored as one file per band is a record input:
  `getSource: (item) => COGSource.open({ red: ..., nir: ... })`. That's the
  Sentinel-2 mosaic, once COGLayer renders record sources (stage 5).

### Sharing

- **Shared:** several layers can take one source instance. They share the
  opened headers, the projection, the tile grid and the header byte cache.
  While the source is opening, they share the promise.
- **Not shared:** tile fetches stay per layer (see Non-goals).

### Cancellation and lifetime

1. **Opening.** Aborting the signal passed to `open()` cancels pending header
   reads, which frees their limiter slots, and rejects with an `AbortError`.
   Whoever creates the promise owns its signal. When a promise is shared, its
   owner decides when to abort: MosaicLayer when the item leaves view, an app
   when the input changes or its view unmounts.
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
| `COGLayer({ geotiff })` | Still works as shorthand (decision 6). `COGLayer({ source })`, with `source` from `COGSource.open(geotiff)`, is the explicit form. |
| `epsgResolver` on COGLayer, MultiCOGLayer, ZarrLayer | `open()` option. Removed from COGLayer in 2a. |
| `concurrencyLimiter` on COGLayer, MultiCOGLayer | `open()` option, removed from COGLayer in 2a. MosaicLayer keeps its prop and forwards it to `getSource`. |
| `onGeoTIFFLoad` | `onSourceLoad(source)` on the shorthand path (COGLayer in 2a). With a `source` prop, read `source.geographicBounds` before creating the layer. |
| `MultiCOGLayer({ sources: { red: { url } } })` | `COGSource.open({ red: url })`. MultiCOGLayer renders it until stage 5, then COGLayer does. |
| `MultiCOGSourceConfig` | Removed. A record of inputs replaces it. |
| `ZarrLayer({ node, variable, metadata })` | `ZarrSource.open(node, { variable, metadata })` |
| `updateTriggers: { renderTile: [selection] }` on ZarrLayer | Not needed (proposal) |

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
     - A `source` prop on COGLayer. `geotiff` becomes the shorthand path,
       which opens a private source.
     - The clean break (decision 11), with the examples moved over.
     - Tests: each input type opens. Aborting mid-open rejects, and an
       already-aborted signal makes no request. A layer given a `source` never
       sets `loadingMetadata`. Two layers sharing one source don't open it
       again. A new source gets a new inner TileLayer.
   - **2b: several files per source.**
     - Record inputs, with the checks above (#723). Failures name the file.
     - A `source` prop on MultiCOGLayer, which takes sources from a record
       until stage 5. Its existing props become the shorthand path, and its
       `onGeoTIFFLoad` becomes `onSourceLoad`.
     - Tests: mismatched CRS and extents are rejected, and Sentinel-2-like
       10/20/60 m bands pass.
3. **MosaicLayer docs and examples.**
   - `getSource` returns a `COGSource`.
   - Port naip-mosaic and vermont-cog-comparison, replacing their caches where
     a shared source is enough.
   - Use `source.geographicBounds` for `fitBounds`.
   - Check the examples in a browser.
4. **`ZarrSource`.**
   - A `source` prop on ZarrLayer, with its existing props as shorthand.
   - Tiles refresh when `selection` changes.
   - Tests mirror stage 2.
5. **COGLayer renders record sources.** It takes over MultiCOGLayer's band
   compositing, and MultiCOGLayer is deprecated (removed later). The Sentinel-2
   mosaic demo follows.

## Open questions

1. **Shorthand.** *Decided:* it stays (decision 6).
2. **A library source cache.** *Decided:* not for now (decision 8). Revisit
   alongside tile-level sharing, which needs the same refcounting.
3. **Moved props.** Deprecate them with warnings for a release, or remove them
   outright, since we're before 1.0? *Decided:* removed outright
   (decision 11).
4. **Timing of stage 5** (COGLayer absorbing MultiCOGLayer): 0.10, or later?
5. **A generic `RasterSource` base class** in deck.gl-raster, with a subclass
   per format (`COGSource`, `ZarrSource`), instead of unrelated classes. The
   base class would hold what every format shares, such as the tile grid, and
   `RasterTileLayer` could store and read it itself. *Decided:* yes
   (decision 10). In 2a, COGLayer stores and reads its source itself. Moving
   that into `RasterTileLayer` can wait for a second layer that needs it.
6. **Where `onSourceLoad` lives.** 2a defines it, with `source`, in
   `RasterSourceLayerProps<SourceT>`, a deck.gl-raster props type that
   COGLayer's props include, rather than on `RasterTileLayer`'s own props.
   `RasterTileLayer` never opens a source itself, so the callback would never
   fire there, and the generic gives each layer its own source type. *Open.*
7. **MosaicLayer's `onSourceLoad`.** MosaicLayer already has
   `onSourceLoad(item, { data })`, where a "source" is a mosaic item (its
   `sources` prop lists the items), not a `RasterSource`. Rename one of them?
   *Open.*

## Left to the implementer

- **Names and types:**
  - `files`, `tileset`, and how a bare input is keyed in `files`.
  - Whether `tileset` becomes a discriminated union, e.g. on
    `kind: "file" | "bands"`.
- **Code organization:** file layout, error wording, and sharing helpers
  between the COG and Zarr `open()` code.
- **Input normalization:** where it happens. Today's `fetchGeoTIFF` already
  handles strings, `URL`s, `ArrayBuffer`s and `GeoTIFF`s.
