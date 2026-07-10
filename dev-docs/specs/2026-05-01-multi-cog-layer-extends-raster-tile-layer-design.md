# MultiCOGLayer Extends RasterTileLayer

## Problem

`MultiCOGLayer` (in `deck.gl-geotiff`) is the only first-party tile layer that still extends `CompositeLayer` directly. It re-implements wiring that `RasterTileLayer` (in `deck.gl-raster`) already provides:

- Globe vs. Web Mercator coordinate-system branching (`coordinateSystem`, `coordinateOrigin`, `modelMatrix`)
- Per-tile `RasterLayer` construction with `reprojectionFns`
- Combining the user's `signal` prop with the inner `TileLayer`'s per-tile `AbortSignal`
- Forwarding `TileLayer` passthrough props (`maxRequests`, `maxCacheSize`, etc.)
- Constructing the inner `RasterTileset2D` factory subclass

That's roughly 150 lines of duplicated boilerplate. It also blocks the future API broadening tracked in [#417](https://github.com/developmentseed/deck.gl-raster/issues/417), because the planned `getTileData` / `renderTile` extension points are most naturally expressed in terms of `RasterTileLayer`'s base hooks.

This spec covers a single mechanical refactor: make `MultiCOGLayer` extend `RasterTileLayer`. No public API changes. The follow-up work that adds the new user-facing extension points is a separate spec.

## Goals

- `MultiCOGLayer extends RasterTileLayer<MultiTileResult, MultiCOGLayerProps>`.
- Drop the duplicated globe/mercator/debug/signal/`TileLayer` wiring; inherit it from the base.
- Preserve the rich multi-band debug overlay (per-band tile outlines and tiered text labels) that the base's default debug overlay does not provide.
- Keep `MultiCOGLayerProps` and runtime behavior unchanged. All existing examples (`naip-mosaic`, `sentinel-2`, `aef-mosaic`) render identically.

## Non-Goals

- Adding the `getTileData` / `renderTile` user-facing extension points (PR 2 — separate spec).
- Changing the multi-resolution fetch + stitch logic. The current `_fetchPrimaryBand` / `_fetchSecondaryBand` and UV-transform computation are preserved verbatim.
- Refactoring the multi-band debug overlay's content or styling.
- Touching `COGLayer` or `ZarrLayer` (already migrated).

## Design

### 1. Base-class hook for extra per-tile sub-layers

`RasterTileLayer._renderSubLayers` is currently `private` and produces, in order:

1. Tile-outline debug paths (when `debug` is true) via `renderDebugTileOutline`.
2. The per-tile `RasterLayer` (when `props.data` is truthy and `renderTile` returned a non-null result).

`MultiCOGLayer`'s rich debug overlay needs access to the per-tile `MultiTileData` (band debug info, secondary tile corners) and the multi-tileset descriptor. To accommodate this without giving subclasses control over the whole `_renderSubLayers` body, add one protected hook:

```ts
/**
 * Hook for subclasses to append additional sub-layers to each rendered tile.
 *
 * Called once per tile inside _renderSubLayers, after the main RasterLayer is
 * constructed. The default implementation returns an empty array.
 *
 * Subclasses can use this to render tile-scoped overlays that depend on the
 * fetched DataT (e.g. multi-band debug outlines).
 */
protected _renderExtraSubLayers(
  tile: Tile2DHeader<DataT>,
  data: DataT,
): Layer[] {
  return [];
}
```

`_renderSubLayers` calls `this._renderExtraSubLayers(tile, props.data)` immediately after building the `RasterLayer` and concatenates the result. Existing direct-use behavior is unchanged: the default returns `[]`.

The base's existing tile-outline debug path (`renderDebugTileOutline`) stays put — it does not depend on `DataT` and applies to every `RasterTileLayer`. Subclasses with richer debug needs simply add to it via the new hook.

### 2. MultiCOGLayer migration

#### Class signature

```ts
export class MultiCOGLayer extends RasterTileLayer<
  MultiTileResult,
  MultiCOGLayerProps
> {
  static override layerName = "MultiCOGLayer";
  static override defaultProps = {
    ...RasterTileLayer.defaultProps,
    epsgResolver: { type: "accessor" as const, value: defaultEpsgResolver },
    debugLevel: { type: "number" as const, value: 1 },
  } as typeof RasterTileLayer.defaultProps;
  // ...
}
```

`MultiCOGLayer`'s existing user-facing props are layered into the second type parameter so the base's `tilesetDescriptor` / `getTileData` / `renderTile` props are excluded — `MultiCOGLayer` doesn't expose those yet.

#### State shape (simplified)

```ts
declare state: {
  sources: Map<string, SourceState> | null;
  multiDescriptor: MultiTilesetDescriptor | null;
};
```

The four projection functions (`forwardTo4326`, `inverseFrom4326`, `forwardTo3857`, `inverseFrom3857`) are dropped from layer state. They already live on the primary `TilesetDescriptor` produced by `geoTiffToDescriptor` and can be read from `state.multiDescriptor.primary` wherever needed (currently only inside the debug overlay's outline projection).

#### Overrides

```ts
protected override _tilesetDescriptor(): TilesetDescriptor | undefined {
  return this.state.multiDescriptor?.primary;
}

protected override _getTileDataCallback() {
  if (!this.state.multiDescriptor || !this.state.sources) {
    return undefined;
  }
  return (tile: TileLoadProps, options: GetTileDataOptions) =>
    this._getTileData(tile, options);
}

protected override _renderTileCallback() {
  if (!this.state.multiDescriptor) {
    return undefined;
  }
  return (data: MultiTileResult): RenderTileResult =>
    this._buildRenderResult(data);
}

protected override _renderExtraSubLayers(
  tile: Tile2DHeader<MultiTileResult>,
  data: MultiTileResult,
): Layer[] {
  if (!this.props.debug || !data.debugInfo) {
    return [];
  }
  return this._renderDebugLayers(tile, data);
}
```

`_buildRenderResult(data)` runs the existing logic from `_renderSubLayers`: builds the `composite` band mapping (default → first source on R), validates required bands are present, calls `buildCompositeBandsProps`, prepends the `CompositeBands` module to the user's `renderPipeline`, and returns `{ image: undefined, renderPipeline }`. When required bands are missing it returns `null` — matching the contract from #489 and ensuring the inner `RasterLayer` is not constructed (preserving today's behavior of skipping the tile entirely).

`_getTileData` keeps the current `tile.signal` + `this.props.signal` composition removed — `RasterTileLayer._wrapGetTileData` already produces a combined signal in `options.signal`, so the user-side `_getTileData` can read `options.signal` directly.

#### Code deleted

- `_renderSubLayers` (the multi-cog one): replaced by the inherited base implementation plus `_renderExtraSubLayers` + `_buildRenderResult`.
- `renderTileLayer`: inherited.
- `renderLayers`: inherited.
- The `forwardTo4326` / `inverseFrom4326` / `forwardTo3857` / `inverseFrom3857` slots in state and the wiring that populates and reads them.
- `_parseAllSources`'s creation of those four converters (the descriptor builder already produces them).
- `WEB_MERCATOR_METER_CIRCUMFERENCE`, `WEB_MERCATOR_TO_WORLD_SCALE`, `TILE_SIZE` constants in this file (already in `raster-tile-layer/constants.ts`, and only used by the deleted globe/mercator branch).

#### Code preserved verbatim

- `_parseAllSources` minus the dropped converter setup.
- `_getTileData` (the multi-source fetch entry point).
- `_fetchPrimaryBand`, `_fetchSecondaryBand`.
- `_renderDebugLayers` (the rich per-band overlay), now wired through `_renderExtraSubLayers` instead of being inlined.
- `cornersToWgs84Path`, `selectImage`, `createBandTexture`.

### 3. File touches

```
packages/deck.gl-raster/src/raster-tile-layer/raster-tile-layer.ts
  + protected _renderExtraSubLayers(tile, data) hook
  + call site in _renderSubLayers

packages/deck.gl-geotiff/src/multi-cog-layer.ts
  major refactor (described above); ~150 lines deleted, no API changes
```

No other files change.

### 4. Testing

- All existing tests pass without modification (no public API changes).
- Manual smoke test in each existing example: `naip-mosaic`, `sentinel-2`, `aef-mosaic`. Verify identical rendering, identical debug overlay, identical fitBounds behavior on `onGeoTIFFLoad`, identical behavior when toggling sources at runtime.
- Verify globe projection still works for `MultiCOGLayer` (the base handles it; this is a non-regression check).
- Verify `signal` prop still aborts in-flight fetches when toggling sources or unmounting.

If unit tests for `MultiCOGLayer` exist and lock down the duplicated wiring (e.g. assertions on `RasterLayer` props), they may need to be relaxed or rewritten against the inherited base behavior.

## Risks / Open Questions

- **Signal composition contract.** `MultiCOGLayer._getTileData` currently composes `tile.signal` + `this.props.signal` itself. The base now does this in `_wrapGetTileData` and forwards the composed signal in `options.signal`. The migration must ensure `_fetchPrimaryBand` / `_fetchSecondaryBand` consume `options.signal`, not `this.props.signal`, to avoid double-composition or regression.
- **`null` vs empty render pipeline for missing-bands case.** The current code returns `null` from `renderSubLayers` when `composite` references an unknown band; the new `renderTile` contract permits returning `null` (issue #489 in recent commits). Use that path so the underlying `RasterLayer` is not constructed at all, matching the previous behavior.
- **Debug overlay sublayer ordering.** Today's `MultiCOGLayer._renderSubLayers` returns `[rasterLayer, ...debugSublayers]`. The base returns `[rasterLayer, ...tileOutlineSublayers]` and the new hook appends after. Verify the visual result is unchanged (it should be — paths and text both render on top regardless of array order in deck.gl since they're layered by sub-layer ID, but worth confirming visually).
