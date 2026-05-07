# MosaicLayer Dynamic Sources

## Problem

`MosaicLayer` only renders the `sources` array provided on first mount. Later updates to the `sources` prop are ignored and the rendered mosaic never grows or shrinks. This is reported in [#510](https://github.com/developmentseed/deck.gl-raster/issues/510), motivated by STAC search pagination in `stac-map`, where new items should be appended to the mosaic as they load.

Root cause: [`MosaicLayer.renderTileLayer`](../../packages/deck.gl-geotiff/src/mosaic-layer/mosaic-layer.ts) builds a `MosaicTileset2DFactory` whose constructor closes over the snapshot value of `mosaicSources`:

```ts
class MosaicTileset2DFactory extends MosaicTileset2D<MosaicT> {
  constructor(opts: any) {
    super(mosaicSources, opts);
  }
}
```

deck.gl's `TileLayer` only instantiates `TilesetClass` once (see `tile-layer.ts` `updateState`). After the first call, the inner tileset is reused across prop updates and never sees the new `sources` array.

## Goals

- Updates to the `MosaicLayer` `sources` prop are picked up automatically by the rendering, with no manual API call required by the consumer.
- The detection of a sources change happens inside the layer lifecycle (during deck.gl's tileset update cycle), not via ad-hoc external state.
- Existing rendered sub-layers and tile cache entries are preserved across `sources` updates whose tile IDs are unchanged. We must not prematurely tear down sub-layers when sources are appended.
- The cache-stability contract is documented on the public `MosaicLayerProps.sources` JSDoc and on the `MosaicSource.x` / `.y` / `.z` JSDoc, so consumers know exactly when to supply explicit identifiers vs. rely on array-position defaults.
- No public API change to `MosaicLayer` or `MosaicTileset2D`. Behavior on the first render is identical.

## Non-Goals

- Stable tile IDs across reordering or middle-removal. Today, sources without an explicit `x`/`y`/`z` get `x: i, y: 0, z: 0` derived from their array index, so the tile ID `${z}-${x}-${y}` is only stable for sources whose array position is stable. Pure append works perfectly. Reordering or middle-removal will invalidate the cache slots of shifted sources, same as today. Consumers who need cache stability across arbitrary mutation can already supply explicit `x`/`y`/`z` per source. We document this contract on the public JSDoc but do not change the default behavior.
- Removing finalized sub-layer resources (deck.gl's existing tile cache eviction handles this).
- Diff-based partial index updates. We rebuild the Flatbush index in O(N) on any reference change. For mosaics in the 10s–1000s of items range this is negligible.

## Design

### 1. `MosaicTileset2D` accepts a sources getter, rebuilds index lazily

Replace the constructor's `sources: MosaicT[]` parameter with a getter `getSources: () => MosaicT[]`. Add a private `ensureIndex()` method that, on each call, fetches the latest sources array, compares by reference to the previously cached array, and rebuilds the source-with-tile-index list and Flatbush spatial index when (and only when) the reference has changed. Call `ensureIndex()` at the top of `getTileIndices`.

```ts
class MosaicTileset2D<MosaicT extends MosaicSource> extends Tileset2D {
  private getSources: () => MosaicT[];
  private cachedRaw: MosaicT[] | null = null;
  private sources: (TileIndex & MosaicT)[] = [];
  private index: Flatbush | null = null;

  constructor(getSources: () => MosaicT[], opts: Tileset2DProps) {
    super(opts);
    this.getSources = getSources;
  }

  private ensureIndex(): void {
    const raw = this.getSources();
    if (raw === this.cachedRaw) return;
    this.cachedRaw = raw;

    this.sources = raw.map((source, i) => ({
      x: source.x ?? i,
      y: source.y ?? 0,
      z: source.z ?? 0,
      ...source,
    }));

    const index = new Flatbush(Math.max(raw.length, 1));
    for (const source of raw) {
      const [minX, minY, maxX, maxY] = source.bbox;
      index.add(minX, minY, maxX, maxY);
    }
    index.finish();
    this.index = index;
  }

  override getTileIndices(opts): (TileIndex & MosaicT)[] {
    this.ensureIndex();
    // existing zoom guards and Flatbush search logic
  }
}
```

Notes:
- `Math.max(raw.length, 1)` because Flatbush requires `numItems >= 1`. An empty sources array still constructs a usable (if empty) index.
- Reference equality (`===`) is the contract: consumers that pass a new array (e.g. via React state with a new array on append) trigger a rebuild; consumers that mutate-in-place do not. This matches deck.gl's standard `data` prop convention.

### 2. `MosaicLayer.renderTileLayer` passes a getter closing over `this.props`

Inside `renderTileLayer`, the inner factory class becomes:

```ts
const self = this;
class MosaicTileset2DFactory extends MosaicTileset2D<MosaicT> {
  constructor(opts: any) {
    super(() => self.props.sources, opts);
  }
}
```

The arrow function captures the `MosaicLayer` instance. deck.gl reuses the same `MosaicLayer` instance across prop updates and swaps `this.props` in place, so the getter always returns the current `sources` array.

### 3. Why the existing flow already triggers `getTileIndices`

No changes are required to the inner `TileLayer` or the `MosaicLayer.updateState` lifecycle. The reactive flow on a `sources` prop update is:

1. `MosaicLayer.renderLayers()` runs and produces a fresh inner `TileLayer` descriptor. `getTileData` and `renderSubLayers` are inline closures, so their references differ each render. `TilesetClass` is also a fresh class.
2. deck.gl matches the inner `TileLayer` by id. Because at least one prop reference differs, `propsChanged` is true and `TileLayer.updateState` calls `tileset.setOptions(opts)`.
3. `Tileset2D.setOptions` resets `_viewport = null`.
4. `_updateTileset` calls `tileset.update(viewport)`. With `_viewport === null`, the guard re-runs `getTileIndices`.
5. `MosaicTileset2D.getTileIndices` calls `ensureIndex()`, which detects the new `sources` reference and rebuilds the Flatbush in O(N). The new index is used immediately for tile selection.
6. `_getTile(index, true)` looks each selected tile up in `tileset._cache` by tile ID. Existing tiles for unchanged sources are returned from cache; new sources produce new tile IDs and trigger fresh fetches.

The `_cache` is preserved across the entire flow — no `reloadAll` is invoked, no `TilesetClass` reinstantiation occurs, and no sub-layer is torn down.

### 4. Public JSDoc updates

Update the JSDoc on `MosaicLayerProps.sources` to document the dynamic-update behavior and the cache-stability contract:

```ts
/**
 * List of mosaic sources to render.
 *
 * The mosaic updates reactively when this prop is replaced with a new array
 * reference. Mutating the array in place will not trigger an update — pass a
 * fresh array (e.g. `[...sources, newItem]`) to add or remove items.
 *
 * Tile cache reuse depends on stable tile IDs. By default, each source's tile
 * ID is derived from its position in this array (see `MosaicSource.x`/`y`/`z`
 * for the exact derivation). This means:
 *
 * - Appending items preserves all existing rendered tiles.
 * - Reordering or removing items from the middle of the array will invalidate
 *   the cache slots of shifted items, causing them to re-fetch.
 *
 * If you need cache stability across arbitrary `sources` mutations, supply
 * explicit `x`, `y`, and `z` identifiers per source so each source's tile ID
 * stays stable regardless of array position.
 */
sources: MosaicT[];
```

Update the `MosaicSource` JSDoc to explain the role of `x` / `y` / `z` as cache identifiers (not viewport coordinates):

```ts
/**
 * Minimal required interface of a mosaic item.
 */
export type MosaicSource = {
  /**
   * Optional tile-cache identifier component. Together with `y` and `z`, forms
   * the tile ID `${z}-${x}-${y}` used to key the inner Tileset2D cache.
   * Defaults to the source's index in the `sources` array. Supply an explicit
   * value when you need cache stability across reordering or removal.
   */
  x?: number;
  /** See `x`. Defaults to `0`. */
  y?: number;
  /** See `x`. Defaults to `0`. */
  z?: number;
  /**
   * Geographic bounds (WGS84) of the source in [minX, minY, maxX, maxY] format
   */
  bbox: [number, number, number, number];
};
```

## Risks

- If a consumer ever stabilizes every prop the `MosaicLayer` passes through to the inner `TileLayer` (so `propsChanged` is false), step 2 above does not trigger. Today this is impossible because `getTileData`, `renderSubLayers`, and `TilesetClass` are all inline-defined per render. We will keep them inline-defined to preserve this behavior.
- An empty initial `sources` array followed by a non-empty update is supported: the initial Flatbush is built with capacity 1 but contains zero adds, and `ensureIndex` rebuilds when the array reference changes.

## Testing

Add a vitest unit test for `MosaicTileset2D` covering:

1. Construction with an empty getter, then a getter returning `[A, B]`, asserts that `getTileIndices` returns A and B for a viewport intersecting both.
2. After a sources reference change appending `[A, B, C]`, `getTileIndices` returns all three. The `cachedRaw` reference now equals the new array.
3. Calling `getTileIndices` twice with the same getter return value does not rebuild the index (assert `index` reference identity).
4. A getter that returns the same reference but with mutated contents does NOT pick up the mutation (documents the reference-equality contract).

No new integration test is needed for `MosaicLayer` itself — the existing examples exercise the renderTileLayer wiring, and the unit tests above cover the new dynamic behavior.
