# Traversal Bounding-Volume Cache

## Problem

`getTileIndices` (the raster tile traversal) runs once per animation frame whenever the viewport changes — a `fitBounds` transition, a pan, a zoom — and it is completely stateless across frames. [`createRootTiles`](../../packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts) allocates fresh `RasterTileNode`s every call, and every visited node's [`getBoundingVolume` → `_getGenericBoundingVolume`](../../packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts) recomputes its bounding volume from scratch: 9 proj4 forward reprojections (`REF_POINTS_9`) plus a `makeOrientedBoundingBoxFromPoints` (covariance + eigendecomposition). The per-node `_boundingVolume` / `_children` caches never survive a frame because the nodes themselves don't.

Per-frame cost ≈ `O(visited nodes) × (9 × proj4.forward + 1 × OBB)`. For the COG path proj4's generic `forward()` pipeline is the heavy term ([`cog-layer.ts`](../../packages/deck.gl-geotiff/src/cog-layer.ts)).

This was made acutely visible by [#513](https://github.com/developmentseed/deck.gl-raster/pull/513) / `4f3e5d0`, which switched the LOD criterion from CSS pixels to *device* pixels. On a 2× display that descends one extra overview level over the whole viewport (~4× more tiles visited) — the device-pixel change is correct (it closes [#64](https://github.com/developmentseed/deck.gl-raster/issues/64)), it just multiplied an already-wasteful per-frame cost. In the `usgs-topo-cutline` example on a Retina display, `getTileIndices` takes ~12 ms/frame and drops frames. Tracked in [#523](https://github.com/developmentseed/deck.gl-raster/issues/523).

## Goals

- Eliminate the per-frame recomputation of tile bounding volumes (proj4 reprojection + OBB construction) during `getTileIndices`, so a steady-state animation frame's traversal cost drops to the inherently per-frame work (frustum culling + the LOD comparison + child-range arithmetic) — well under 1 ms for a typical view.
- Bound the cache's memory: it caches *visited* tiles only (populated lazily), is LRU-evicted with a generous configurable cap, and is owned by — and dies with — the `RasterTileset2D` instance.
- No behavior change: the set of selected tile indices for a given viewport/zRange/pixelRatio is identical to today's. Standalone/test callers of `getTileIndices` / `createRootTiles` that pass no cache behave exactly as before.
- No new public API on `RasterTileLayer` or `RasterTileset2D` beyond an optional, internal-leaning `RasterTileset2DOptions.maxBoundingVolumeCacheSize`.

## Non-Goals

- The EPSG:4326 / mercator-family axis-aligned fast path for `getBoundingVolume` (the "Case 2/3" TODOs in `getBoundingVolume`). Separate follow-up; reduces the *cold* per-node cost but is orthogonal to memoization. (#523)
- Removing the redundant double-wrap of `makeClampedForwardTo3857` (applied in `cog-layer.ts` and again inside `sampleReferencePointsInEPSG3857`). Separate follow-up. (#523)
- Promoting `RasterTileNode`s to cached singletons ("cache the whole node tree"). Considered and rejected — see Alternatives.
- Caching anything that depends on the viewport (frustum-culling results, LOD decisions, the selected set). Those legitimately change every frame and are cheap.
- Globe-view bounding volumes. `getBoundingVolume` currently `assert(false)`s when `project` is non-null (Globe view), so the bounding volume is a pure function of `(z, x, y, zRange)`. When Globe support lands the cache key will need a viewport-resolution component; this spec leaves a comment marking that.

## Design

### 1. New: `BoundingVolumeCache` (`packages/deck.gl-raster/src/raster-tileset/bounding-volume-cache.ts`)

An LRU `Map` wrapper. Key: the `"z/x/y"` string. Value: `{ zRange: ZRange; boundingVolume: OrientedBoundingBox; commonSpaceBounds: Bounds }` — exactly what `_getGenericBoundingVolume` already returns, plus the `zRange` it was computed for.

```ts
export interface BoundingVolumeCacheOptions {
  /** Soft cap on the number of cached tile bounding volumes. When a
   *  `getTileIndices` traversal starts and the cache is over this size, the
   *  least-recently-used entries are dropped down to ~half. Eviction never
   *  runs mid-traversal, so a single frame is never starved of an entry it
   *  computed earlier that same frame. */
  maxEntries?: number;
}

export class BoundingVolumeCache {
  // implementation: Map<string, Entry>; default maxEntries = 1 << 16
  get(z: number, x: number, y: number): Entry | undefined; // on hit: delete + re-set to bump recency
  set(z: number, x: number, y: number, entry: Entry): void;
  /** Drop LRU entries down to ~maxEntries/2 if over cap. Call once at the
   *  top of each getTileIndices traversal. No-op if under cap. */
  sweep(): void;
  /** test introspection */
  get size(): number;
}
```

`maxEntries` default `1 << 16` (≈65 k entries × ~200 B ≈ ~13 MB worst case). For a single COG the entire overview pyramid is ~10³ tiles, so the cap is never approached in practice; it exists to bound the large-single-level-zarr / long-pan-session case. The cap is a *soft* cap because a single frame's working set could in principle exceed it, and we never evict mid-frame.

LRU via `Map` insertion order: on `get` hit, `delete` then `set` (moves the key to the end = most-recently-used); `sweep` deletes from the front (oldest) until `size <= maxEntries / 2`.

### 2. `RasterTileset2D` owns one cache

- `RasterTileset2DOptions` gains `maxBoundingVolumeCacheSize?: number`, forwarded into `new BoundingVolumeCache({ maxEntries })`.
- `RasterTileset2D` constructs one `BoundingVolumeCache` in its constructor (alongside `getPixelRatio`).
- `RasterTileset2D.getTileIndices()` passes the cache to the `getTileIndices` free function via a new optional `opts.boundingVolumeCache`.

No new `RasterTileLayer` prop; the layer uses the default cap.

### 3. Thread the cache through the traversal

- `getTileIndices(descriptor, opts)`: `opts.boundingVolumeCache?: BoundingVolumeCache`. At the top, call `boundingVolumeCache?.sweep()`. Pass it to `createRootTiles(...)` and into every `new RasterTileNode(x, y, z, { descriptor, boundingVolumeCache })`.
- `createRootTiles(opts)`: gains optional `boundingVolumeCache`, forwards it to the `RasterTileNode`s it creates (both the small-root and large-root paths).
- `RasterTileNode`: constructor option `boundingVolumeCache?: BoundingVolumeCache`, stored as a field. The `children` getter forwards `this.boundingVolumeCache` to each child `RasterTileNode` it creates. So every node in a traversal tree carries the (same, optional) cache reference.
- `RasterTileNode.getBoundingVolume(zRange, project)`:
  - If `this.boundingVolumeCache` is set: look up `(z, x, y)`. On hit *and* `entry.zRange[0] === zRange[0] && entry.zRange[1] === zRange[1]` → return `entry`. On miss or zRange mismatch → `_getGenericBoundingVolume(zRange)`, `cache.set(z, x, y, { zRange, ...result })`, return.
  - If `this.boundingVolumeCache` is *not* set: existing behavior — use the per-node `_boundingVolume` field exactly as today (zRange-checked). This keeps `create-root-tiles.test.ts`, `tileset-refinement.test.ts`, and any other direct caller bit-for-bit unchanged.

The per-node `_boundingVolume` field stays; with a shared cache present it's effectively dead (nodes are ephemeral), but leaving it keeps the no-cache code path untouched and the diff small. `_getGenericBoundingVolume` is unchanged.

### 4. Everything else unchanged

`createRootTiles`'s two paths, `update()`, the frustum culling, the LOD comparison (`devicePixelsPerSourcePixel <= 1`), `getSelected`, the overdraw / `childVisible` logic, the per-tile output, `pixelRatio` threading. Nodes stay ephemeral (allocated per frame, garbage-collected after) — so there is no stale-state surface to reason about. The only thing that crosses a frame boundary is the bounding-volume cache, whose values are immutable and depend only on `(z, x, y, zRange)`.

### Data flow (steady-state frame, cache warm)

```
RasterTileLayer (deck.gl TileLayer drives updateState on viewport change)
  └─ RasterTileset2D.getTileIndices({ viewport, zRange })
       └─ getTileIndices(descriptor, { ..., boundingVolumeCache })
            ├─ boundingVolumeCache.sweep()                  // no-op unless over cap
            ├─ createRootTiles({ ..., boundingVolumeCache }) // ≤ MAX_ROOT_TILES_NO_CULL nodes, or viewport-culled
            └─ for each root: root.update(params)
                 per visited node:
                   getBoundingVolume → cache HIT (Map.get)  // proj4 + OBB skipped
                   bounds check · cullingVolume.computeVisibility(obb)
                   children getter → child-range arithmetic + small alloc
                   LOD: worldToLngLat(obb.center) → getMetersPerPixel → compare
                   recurse if needed
            └─ collect selected via getSelected(roots)
```

## Error handling / edge cases

- **zRange oscillation:** if `zRange` flips between values, the affected key recomputes each flip but the cache doesn't grow (same key overwritten). Pathological and rare (only terrain/elevation use non-`[0,0]` zRange).
- **Descriptor change:** the descriptor is immutable for a `RasterTileset2D` instance's lifetime. A layer `data`/`geotiff` change produces a new layer → new sublayer `TileLayer` → new `Tileset2D` → fresh cache. No explicit invalidation needed.
- **No cache passed:** `getBoundingVolume` falls back to the per-node `_boundingVolume` field; identical to current behavior.
- **Single frame larger than the cap:** `sweep()` only runs at frame start, so the frame completes without evicting anything it needs; the next frame trims back down. The cap is sized so this essentially never happens.
- **Globe view:** unsupported in `getBoundingVolume` today (`assert(false)`); a comment on the cache key notes a viewport component will be needed when it's implemented.

## Testing

- **Memoization (write first, red):** a fake `TilesetDescriptor` whose `projectTo3857` increments a call counter. Construct a `RasterTileset2D` with `{ getPixelRatio: () => 2 }` and a default cache; call `getTileIndices` with the same viewport twice. Assert: (a) the proj4 counter is unchanged between call 1 and call 2; (b) the returned `TileIndex[]` of call 2 deep-equals that of call 1. Red without the cache (counter doubles); green with it.
- **Eviction / bound:** construct with a small `maxBoundingVolumeCacheSize` (e.g. 8); step the viewport across enough distinct tiles over several `getTileIndices` calls that the cumulative distinct-tile count exceeds the cap; assert `cache.size <= maxEntries` after each call and that the selected indices each call still match a no-cache reference run (re-warming is correct).
- **No-cache parity:** a test that `getTileIndices` / `createRootTiles` called without a cache return the same results as before (covered largely by the existing suite — `create-root-tiles.test.ts`, `tileset-refinement.test.ts`, `lod-pixel-ratio.test.ts`, `affine-tileset*.test.ts` — which must pass unchanged).
- No wall-clock timing assertion (flaky in CI); the proj4-call-count test is the deterministic proxy for "the expensive work is memoized."

## Alternatives considered

- **Cache the whole `RasterTileNode` tree** (singletons keyed `"z/x/y"`, `_children` / `_boundingVolume` surviving across frames; zero per-frame allocation after warmup). Rejected: nodes hold child *references* (a tree), so an LRU evict from the by-key map doesn't free a node while its parent is still cached — forcing a restructure to cache a child *range* instead of refs, plus handling stale `selected` / `childVisible` on reused nodes (a `childVisible`-gated `getSelected` and a `return`-after-push). More memory per entry, more moving parts, the same LRU cap still required, for a marginal extra win (~0.3 ms vs ~1 ms — both far under a 16 ms frame). The chosen approach keeps nodes ephemeral and the diff minimal.
- **Don't default the LOD criterion to device pixels** (revert #513's default, or clamp `pixelRatio`). Sidesteps the 4× but gives back the #64 sharpness win and doesn't address the underlying per-frame waste. Out of scope here; could still be done independently.
- **Skip `getTileIndices` when the viewport hasn't moved enough.** Doesn't help during an actual animation, which is exactly the reported case.
