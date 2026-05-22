# Per-origin concurrency limiter for tile-source HTTP requests

- **Date:** 2026-05-19
- **Issues:** [#273](https://github.com/developmentseed/deck.gl-raster/issues/273)
- **Status:** Design — supersedes [`2026-05-12-getTileData-coalescing-design.md`](2026-05-12-getTileData-coalescing-design.md), which was scoped to *both* coalescing and gating; this spec narrows to gating only and explicitly defers coalescing.

## Background

Most COGs `deck.gl-raster` targets live on AWS S3 or similar object stores, which serve HTTP/1.1 only. Chrome (and other major browsers) cap concurrent HTTP/1.1 connections per origin at ~6. Over-scheduling above that point means the browser queues the excess, and queued requests stick around even when the viewport pans — so stale-after-pan requests block fresh ones for the new viewport. The browser cap is **global to the page**, not per-layer.

deck.gl's `Tileset2D` ships an internal `loaders.gl/RequestScheduler({ maxRequests: 6 })` but it's *per-`TileLayer` instance*: two `COGLayer`s targeting the same S3 bucket each get 6 slots, so the browser sees 12+ requests and queues them. That scheduler also counts `getTileData` calls (≈ tiles), not HTTP requests, and one COG tile fetch issues several requests (metadata + data + mask) — so the per-tile cap is a poor proxy for the actual network-cap that matters.

The fix is a concurrency limiter at the *source* layer (between `Source.fetch` and the network), per-origin, **shared across layers** targeting the same host. This spec specifies that limiter and its integration into `@developmentseed/geotiff` and `@developmentseed/deck.gl-geotiff`.

### How `Tileset2D._pruneRequests` interacts with `maxRequests`

deck.gl's `Tileset2D` fires a tile's abort signal in exactly one place: `_pruneRequests`, which only triggers when ongoing requests exceed `maxRequests`. So setting `maxRequests = 0` disables that pruning entirely — stale tiles' signals never fire, and the source-level limiter never sees a cancellation. We therefore keep `maxRequests` at its current pass-through behavior (deck.gl default 6) and accept that the per-layer cap and the source-level cap coexist as two independent (slightly redundant) gates. A future change that wants per-tile pruning *without* a per-layer cap will need to subclass `Tileset2D`; that's out of scope here.

## Goals

1. Cap concurrent HTTP requests **per origin**, **shared across all layers** (and source formats — COG today, Zarr or similar tomorrow) targeting that origin.
2. Signal-aware queueing: when a queued request's `signal` aborts (e.g. user panned away), the request is dropped without firing a network call.
3. **Dynamic priority**: callers attach a `getPriority` callback to each fetch; the limiter re-evaluates it on every slot-open so the queue re-orders when the viewport pans, surfacing newly-central sources ahead of stale edge sources.
4. Zero-config default that works out of the box (cross-layer per-origin gating on, `maxRequests = 6`), with explicit opt-out and explicit override per layer.
5. No new dependency added; no implicit module-level state hidden inside `@developmentseed/geotiff`.

## Non-goals (deferred, not removed from consideration)

- **Multi-tile request coalescing** (`TileBatcher`, `getMultiTileData`, `fetchTilesSettled` used from a layer): the user-facing trade-off between batching shape (row/box/single) and time-to-first-pixel is real, and integrating with deck.gl's pruning is nontrivial. Decided to ship gating first and revisit coalescing as a follow-up; the API here doesn't preclude it.
- Subclassing `Tileset2D` to fire abort signals from `onTileUnload` independent of `maxRequests` — needed eventually if a future batcher wants `maxRequests = 0` with working cancellation.
- Pluggable batching strategy (when a batcher is added).
- Upstream deck.gl proposals (`getTileDataBatched`, exposing `_requestScheduler`, signalling abort on unload).
- Extracting the limiter to a new shared package (e.g. `@developmentseed/concurrency`). Lives in `@developmentseed/geotiff` for now; revisit if a non-geotiff source-type ever wants to share an instance.

## Architecture

Four types, all in `@developmentseed/geotiff`:

```ts
/** Priority for one queued request. Numbers compare numerically; arrays
 *  compare lexicographically, with missing trailing elements treated as 0
 *  (so `[1]` and `[1, 0, 0]` are equivalent, and `[1, -1]` jumps ahead of
 *  `[1]`). Lower = serviced sooner. */
export type Priority = number | readonly number[];

/** The public contract a layer / source can accept. */
export interface ConcurrencyLimiter {
  /** Acquire a slot to perform one fetch to `url`. Resolves to a release
   *  function (call it once when the fetch settles). If `signal` aborts while
   *  the call is queued, the promise rejects with the signal's reason and no
   *  slot is consumed.
   *
   *  `getPriority` is re-invoked on every slot-open: on each release, the
   *  limiter scans pending waiters, evaluates each one's `getPriority`, and
   *  resumes the lowest-priority waiter. Pan the viewport between releases
   *  and the next scan sees the new values — no explicit re-queue. Omit it
   *  (or have it return a constant) for FIFO behavior. */
  acquire(
    url: URL,
    signal?: AbortSignal,
    getPriority?: () => Priority,
  ): Promise<() => void>;
}

/** Default implementation. Maintains one Semaphore per URL origin; new origins
 *  mint a new Semaphore lazily with the same `maxRequests`. Two layers on the
 *  same origin share one cap; two layers on different origins don't compete. */
export class PerOriginSemaphore implements ConcurrencyLimiter {
  constructor(opts: { maxRequests: number });
  acquire(
    url: URL,
    signal?: AbortSignal,
    getPriority?: () => Priority,
  ): Promise<() => void>;
}

// Internal (not exported from index.ts):

/** Counting semaphore with signal-aware acquire and dynamic priority. On each
 *  release, linear-scans the pending list, evaluates each waiter's
 *  `getPriority`, and resumes the min. Waiters without a `getPriority` are
 *  treated as `+Infinity` so explicit-priority waiters always run first; ties
 *  break by insertion order (so it degrades to FIFO when nobody supplies
 *  priorities). Linear scan rather than a heap because priorities change
 *  under the structure between releases — a heap would have to be rebuilt
 *  each time anyway. */
class Semaphore {
  constructor(opts: { maxRequests: number });
  acquire(
    signal?: AbortSignal,
    getPriority?: () => Priority,
  ): Promise<() => void>;
}

/** chunkd `SourceMiddleware` class, shape matches `SourceChunk` / `SourceCache`.
 *  Gates one `Source.fetch` through `limiter.acquire(url, signal, getPriority)`,
 *  forwarding the call's signal so a queued abort drops the request. Composes
 *  with the header source's existing middleware stack (chunking + cache → then
 *  limiter), so cache hits never burn a slot. */
class LimiterMiddleware implements SourceMiddleware {
  name: "limiter";
  constructor(opts: {
    url: URL;
    limiter: ConcurrencyLimiter;
    getPriority?: () => Priority;
  });
  fetch(req: SourceRequest, next: SourceFetch): Promise<ArrayBuffer>;
}
```

`Semaphore` is internal because users have no reason to construct one directly — `PerOriginSemaphore` is the public class. Keeping it internal also avoids the "which one do I use?" question. Promote later if someone wants a flat (single-pool) limiter.

`LimiterMiddleware` is also internal: the limiter is wired by `GeoTIFF.fromUrl` (where chunkd's `Source` / `SourceView` types are already in scope), so callers don't need to compose middleware themselves.

> **Implementation note (temporary).** The `SourceMiddleware` shape above is the intended design, but it doesn't work yet: chunkd's `SourceView` doesn't forward the request `signal` to middleware, so a middleware can't observe an abort (only the underlying source receives the read options via `SourceView`'s terminal handler). Until that's fixed upstream ([chunkd#1697](https://github.com/blacha/chunkd/pull/1697)), the limiter is implemented as an internal **source wrapper** — `LimitedSource` — composed *beneath* `SourceChunk` / `SourceCache` (as the `SourceView`'s source) rather than as a middleware on top. Cache hits still short-circuit in `SourceCache` before reaching it. This is internal-only; the public API is unchanged either way. Revert to `LimiterMiddleware` once chunkd ships the fix — tracked in [#565](https://github.com/developmentseed/deck.gl-raster/issues/565).

## Integration

### `@developmentseed/geotiff`

- `GeoTIFF.fromUrl(url, { …, concurrencyLimiter?, getPriority? })` — `concurrencyLimiter: ConcurrencyLimiter | null | undefined`, `getPriority: () => Priority`. When `concurrencyLimiter` is non-null, constructs `new LimiterMiddleware({ url, limiter, getPriority })` and slots it into both the header source's `SourceView` (after `SourceChunk` + `SourceCache`, so cache hits short-circuit before the limiter) and a tiny `SourceView` wrapping the raw data source. When `null` or `undefined`, no gating; `getPriority` is then a no-op. (`fromUrl` does *not* default to a shared limiter — that's a layer-level concern; see below.)
- `GeoTIFF.open({ … })` — unchanged. Users wanting gating with `open` wire the middleware themselves before calling.

Both header and data fetches gate so the limiter has full visibility into per-origin demand; cache hits in the header path short-circuit before reaching the limiter (the middleware order in the `SourceView` puts `SourceCache` ahead of `LimiterMiddleware`).

### `@developmentseed/deck.gl-geotiff`

A module-level default instance lives here (not in `@developmentseed/geotiff`, so consumers of `geotiff` that don't use layers don't get a stray module-load semaphore):

```ts
// packages/deck.gl-geotiff/src/default-concurrency-limiter.ts (or top of cog-layer.ts)
import { PerOriginSemaphore } from "@developmentseed/geotiff";

/** Shared by every COGLayer / MultiCOGLayer that doesn't override its
 *  concurrencyLimiter prop, so multiple layers on the same origin share one
 *  HTTP/1.1 connection pool. */
export const DEFAULT_CONCURRENCY_LIMITER = new PerOriginSemaphore({ maxRequests: 6 });
```

`COGLayer`:

```ts
class COGLayer extends RasterTileLayer {
  static override defaultProps = {
    ...RasterTileLayer.defaultProps,
    concurrencyLimiter: DEFAULT_CONCURRENCY_LIMITER,
  };
}

// props type:
type COGLayerProps = … & {
  /** Caps concurrent HTTP requests to each origin this layer fetches from.
   *  Defaults to a module-level shared `PerOriginSemaphore({ maxRequests: 6 })`
   *  so two layers on the same bucket share one cap. Pass your own to override;
   *  pass `null` to disable gating. */
  concurrencyLimiter?: ConcurrencyLimiter | null;
};
```

The layer threads its prop into `fetchGeoTIFF(url, { concurrencyLimiter })` → `GeoTIFF.fromUrl(url, { concurrencyLimiter })`. When `props.geotiff` is a pre-opened `GeoTIFF` instance, the prop is ignored (doc note: "you already wired the limiter at `fromUrl`/`open` time").

Same module-level default is reused by `MultiCOGLayer` and `MosaicLayer` (and any other layer that opens a `GeoTIFF`) so cross-layer-type sharing works out of the box.

#### `MosaicLayer` — viewport-aware priority

`MosaicLayer`'s `getTileData` builds a `getPriority` closure per source: euclidean distance from `source.bbox` center to `this.context.viewport.{longitude, latitude}` in degree-space (just an ordering key — great-circle isn't needed). The closure reads `this.context.viewport` lazily, so each invocation sees the *current* viewport, not the one at queue time.

The closure plus the layer's `concurrencyLimiter` (resolved as `defaultProps`-fill with explicit `null` preserved as opt-out) are passed through `getSource(source, opts)`. A consumer's `getSource` can spread `opts` straight into `GeoTIFF.fromUrl`, so a typical usage is one line:

```ts
new MosaicLayer({
  sources,
  getSource: async (source, opts) =>
    getCachedGeoTIFF(source.assets.image.href, opts),
  renderSource: …,
});
```

`COGLayer` / `MultiCOGLayer` don't (yet) thread a `getPriority` — they only have a single source per layer, so dynamic priority doesn't reorder anything across layer boundaries. If consumers want priority across many `COGLayer`s sharing one limiter, they can construct their `GeoTIFF` outside the layer and pass `getPriority` to `fromUrl` themselves.

`RasterTileLayer.props.maxRequests` is unchanged — still passed through to deck.gl's `Tileset2D`. Independent cap from the source-level one; users typically leave it at deck.gl's default 6 so `_pruneRequests` keeps firing.

## Cancellation flow

1. User pans. deck.gl's `Tileset2D._pruneRequests` fires `tile.abort()` for unselected in-flight tiles (because `ongoing > maxRequests`).
2. The tile's `AbortController.signal` aborts. `getTileData(tile, { signal })` (already awaiting our chain) sees it.
3. The signal threads through `fetchTile(image, { x, y, signal })` → `dataSource.fetch(offset, length, { signal })`.
4. `LimiterMiddleware` passes the signal to `limiter.acquire(url, signal, getPriority)`:
   - Already aborted on entry → reject immediately, no slot consumed.
   - Aborted while queued in the inner `Semaphore` → splice from the queue, reject, no slot consumed.
   - Aborted in-flight (after acquiring the slot) → the underlying `fetch` itself aborts via its own signal handling; the `finally` releases the slot.

## Priority flow

1. Layer builds a `getPriority` closure that reads the current viewport when invoked.
2. Closure threads through `getSource(opts)` → `GeoTIFF.fromUrl({ getPriority })` → `LimiterMiddleware` → `limiter.acquire(url, signal, getPriority)` → `Semaphore.acquire(signal, getPriority)`.
3. On each release, `Semaphore` linear-scans pending waiters, calls each `getPriority()` (catching synchronous throws → treat as `+Infinity` so a broken closure can't deadlock the queue), picks the min, and resumes it. Panning between releases mutates the values the next scan sees — no explicit re-queue or external "reprioritize" call.
4. We don't use a priority queue / heap here because priorities are *not* stable under the structure: a heap built from one snapshot would have to be rebuilt each time the viewport moves. A linear scan is O(N) per release and trivially correct; queue depths in practice are bounded by the number of overlapping sources visible at once (single digits to low hundreds), so the constant factor is fine.

## Testing

- `Semaphore` (unit): FIFO ordering when no priority is given; `maxRequests` honored; `acquire(signal)` rejects on already-aborted; aborts while queued splice cleanly without consuming a slot; release is idempotent; explicit priorities serviced lowest-first; dynamic priority — a waiter's `getPriority` return value can change between releases and the next release picks the new min; ties break by insertion order; a `getPriority` that throws is treated as `+Infinity` (no deadlock).
- `PerOriginSemaphore` (unit): two different-origin `acquire`s don't compete; two same-origin acquires share one pool; per-origin Semaphores are minted lazily; `getPriority` is forwarded to the right per-origin Semaphore.
- `comparePriorities` (unit): numbers compared numerically; arrays compared lex; missing trailing elements treated as 0; mixed number / array comparisons.
- `LimiterMiddleware` (unit): forwards `offset`/`length`/`options` unmodified to `next`; releases on resolve and on throw; forwards `options.signal` and the constructor's `getPriority` to `limiter.acquire`.
- `GeoTIFF.fromUrl({ concurrencyLimiter, getPriority })` (integration, with a recording counting limiter wrapping a fixture file source): with `maxRequests: 1`, `peak in-flight` never exceeds 1; both header (cache miss) and data source `.fetch` are gated; cache hits in the header path don't burn a slot; `getPriority` is forwarded to every `acquire`.
- `COGLayer.defaultProps.concurrencyLimiter` (unit): `COGLayer`, `MultiCOGLayer`, and `MosaicLayer` instances without explicit prop end up with the same limiter instance.

## Future work (for design context, not built here)

- **Coalescing**: `TileBatcher` / `getMultiTileData` / `fetchTilesSettled` from a layer-side dispatcher. The tension with `_pruneRequests` (which only fires when `ongoing > maxRequests`) means the batcher either accepts small (per-wave) coalescing windows or requires a `Tileset2D` subclass that fires aborts on `onTileUnload`. Pluggable batching strategy — row vs box vs single — exposed via a structured `groupKey: (tile) => { z, y }` (or similar) on the batcher.
- **Upstream deck.gl proposals** (likely worth opening issues for):
  - Make `Tileset2D.pruneRequests` a *public* method (currently `_pruneRequests`) so callers can trigger cancellation of unselected in-flight tiles imperatively — e.g. our source-level limiter could ask the tileset to drop stale tiles when its queue grows past a threshold, instead of relying on the implicit "ongoing > maxRequests" trigger.
  - Fire tile abort signals on `onTileUnload` (cache eviction) independent of `maxRequests`, so cancellation works when `maxRequests = 0`.
  - Expose `_requestScheduler` as `requestScheduler` (or an interface) so callers can inspect / replace it.
  - Add a native `getTileDataBatched` prop (the original request behind this whole design).
- **Shared concurrency package**: if a non-geotiff source format (Zarr, etc.) ever wants the same `ConcurrencyLimiter` *instance* a `COGLayer` is using, the limiter primitives extract cleanly to a new package and both packages depend on it.
