# Coalescing tile fetches through deck.gl `getTileData` (`COGLayer`)

**Date:** 2026-05-12
**Issues:** [#273](https://github.com/developmentseed/deck.gl-raster/issues/273); related deck.gl [visgl/deck.gl#10098](https://github.com/visgl/deck.gl/issues/10098)
**Status:** Design — builds on [#531](https://github.com/developmentseed/deck.gl-raster/pull/531) (`geotiff.fetchTiles`, range-coalescing batched reader).

## Background

deck.gl's `TileLayer` has exactly one fetch hook, `getTileData(tile, { signal, … })`, called **once per tile**. For tile sources where each tile is a separate URL (MVT), that's unavoidable. For a COG, every tile in a viewport is a byte range of the *same* file, and adjacent tiles' ranges are contiguous (or near-contiguous) on disk — so N independent range requests could be a handful of coalesced ones. [#531](https://github.com/developmentseed/deck.gl-raster/pull/531) gave `@developmentseed/geotiff` a `fetchTiles(xy[])` that does exactly that coalescing for a *known* batch. What's missing is getting deck.gl's stream of per-tile `getTileData` calls *to* `fetchTiles`.

The deck.gl-native fix — a `getTileDataBatched` prop wired into `Tileset2D` — is proposed upstream ([visgl/deck.gl#10098](https://github.com/visgl/deck.gl/issues/10098)) but has no PR and no maintainer commitment, so this lives in our packages. We follow the upstream-proposed shape closely so that, if/when it lands, our shim collapses to a thin adapter.

### How deck.gl loads tiles today (relevant facts)

- `Tileset2D` constructs a loaders.gl `RequestScheduler({ maxRequests: 6, debounceTime })` internally; `Tile2DHeader._loadData` does `await requestScheduler.scheduleRequest(this, …)` then `await getTileData(...)`. So `getTileData` is gated to `maxRequests` (default 6) concurrent calls, in a rolling window (a slot frees when `getTileData` resolves).
- When `maxRequests <= 0` (and `debounceTime <= 0`), the scheduler's `throttleRequests` is `false` and `scheduleRequest` returns an already-resolved token — so `getTileData` is called for every needed tile with no throttling.
- `Tileset2D._updateTileStates` loops over the needed tile indices **synchronously**, spawning one `loadData` (async) each. With throttling off, each `getTileData` call is one microtask later — so the whole burst of `getTileData` calls for a viewport update completes within the current macrotask (before its microtask queue drains).
- `Tileset2D._pruneRequests` aborts *unselected* in-flight tiles when more than `maxRequests` are ongoing — a no-op when `maxRequests <= 0`.
- The `maxRequests` cap counts **`getTileData` calls (≈ tiles)**, not HTTP requests. But a single COG tile fetch can issue several HTTP requests — an (uncached) tile-offset metadata read, the tile-data read, and a mask read — so "tiles in flight" is a poor proxy for "HTTP requests in flight", which is what the browser's ~6-per-origin HTTP/1.1 limit actually constrains.

### Current code shape in our packages

- `@developmentseed/deck.gl-raster` — `RasterTileLayer` (subclass of `CompositeLayer`) builds the inner `@deck.gl/geo-layers` `TileLayer` in `_renderTileLayer`, passing `getTileData: tile => this._wrapGetTileData(tile, getTileData)` and a `TilesetClass` subclass of `RasterTileset2D`. `_wrapGetTileData` adapts deck.gl's `(tile, { signal, device }) => …` into the layer's `getTileData` and (for `COGLayer`) resolves `tile.index.z` to an overview vs. the primary image. Subclasses override `_getTileDataCallback()` / `_renderTileCallback()` / `_tilesetDescriptor()` to supply defaults.
- `@developmentseed/deck.gl-geotiff` — `COGLayer` extends `RasterTileLayer`; in `updateState` it opens a `GeoTIFF` (`GeoTIFF.open` / `fromUrl`) and stores it in state; its default `getTileData` calls `geotiff.fetchTile(image, { x, y, … })`.
- `@developmentseed/geotiff` — `GeoTIFF.open({ dataSource, headerSource })`; the header source is a chunkd `SourceView(http, [SourceChunk(64 KiB), SourceCache(…)])` (block cache) and the data source is a raw `SourceHttp` (uncached). `fetchTile` / `fetchTiles` / `coalesceRanges` / `assembleTile` issue `source.fetch(offset, length, { signal })` calls; `coalesceRanges` merges nearby ranges and dispatches up to `COALESCE_PARALLEL = 6` in parallel.

## Goals

1. A `COGLayer` viewport of N tiles should produce **far fewer than N HTTP requests** — adjacent tiles' byte ranges coalesced, via `geotiff.fetchTiles`.
2. **`maxRequests` should bound the number of actual HTTP requests in flight** (coalesced tile-data reads *and* uncached metadata reads *and* mask reads), since that's the browser-imposed limit that matters.
3. **Zero behavior change when the feature isn't used**: a layer with no batched callback takes the exact code path it does today.
4. Generic mechanism at the `RasterTileLayer` level (subclasses opt in by defining a batched callback); only `COGLayer` opts in for now.
5. No new dependency added to `@developmentseed/geotiff` (in particular, no `loaders.gl`); `geotiff`'s public `fetchTile` / `fetchTiles` signatures unchanged.

## Non-goals

- The deck.gl-native `getTileDataBatched` prop (upstream; out of scope here).
- `MultiCOGLayer` / `MosaicLayer` batching (the batcher's grouping key is designed to allow it later, but it isn't wired up).
- A `maxTilesPerBatch` cap (bounding how many tiles ride one all-or-nothing coalesced fetch — relevant given the composite-signal semantics below; a likely future knob, not built now).
- Per-tile *streaming* (`Promise<DataT>[]` so a fast tile resolves before a slow one) — `fetchTiles` does one coalesced fetch then near-synchronous per-tile decode, so there's nothing to interleave; a single `Promise<Array<DataT | Error>>` suffices.
- Exporting the scheduler middleware publicly (internal for now).

## Architecture

Two independent pieces:

1. **`TileBatcher`** (in `@developmentseed/deck.gl-raster`) — *coalesces* deck.gl's per-tile `getTileData` calls into one batched call per zoom level. This is what turns N requests into a handful.
2. **A concurrency-limiter chunkd middleware** (in `@developmentseed/geotiff`) — *gates* the number of concurrent HTTP `fetch`es. This is what makes `maxRequests` mean "HTTP requests in flight". Independent of batching — it sits on the byte source, so it sees every real request (coalesced data ranges, uncached metadata, masks) regardless of who issued it.

They're combined only at the `COGLayer` level: when a batched callback is in play, `RasterTileLayer` creates one limiter from `props.maxRequests`, hands it to the `GeoTIFF` (so the middleware is installed on its sources), and runs the batcher; the inner `TileLayer` gets `maxRequests: 0` so deck.gl's per-tile throttle steps aside for our HTTP-level one.

```
                            RasterTileLayer (getMultiTileData defined)
                               │  creates  RequestScheduler({maxRequests: props.maxRequests})  ← loaders.gl class
        inner TileLayer        │           wrapped in a ~2-line adapter to geotiff's
   maxRequests: 0 ────────────►│            ConcurrencyLimiter ({ acquire(): Promise<()=>void> })
   getTileData: t => batcher.fetch(t)
                               │
   deck.gl  ──N×getTileData──► TileBatcher ──buffer, setTimeout(0)──► flush:
                               │   group by (sourceId, z); z→image; composite signal/group
                               │
                               └──1× getMultiTileData(image, tiles[], {signal, device, pool})──►
                                        COGLayer default ──► geotiff.fetchTilesSettled(xy)
                                                                  │  source.fetch(...) × few
                                                                  ▼
                                  GeoTIFF sources, opened with { concurrencyLimiter }:
                                     header: SourceView(http, [SourceChunk, SourceCache, limiterMW])
                                     data:   SourceView(http, [limiterMW])
                                            limiterMW: const release = await limiter.acquire(); try { next() } finally { release() }
```

## `@developmentseed/geotiff` changes

### 1. A minimal `ConcurrencyLimiter` interface

```ts
/**
 * Minimal contract for capping the number of concurrent {@link Source.fetch}
 * calls, without coupling this package to any particular limiter / scheduler
 * implementation (e.g. loaders.gl's `RequestScheduler`).
 */
export interface ConcurrencyLimiter {
  /** Acquire a slot. Resolves once a slot is free; call the returned function
   *  exactly once when the request finishes (success or failure) to release it. */
  acquire(): Promise<() => void>;
}
```

No `unknown`, no token object, no `null` — geotiff has no notion of request identity, priority, or cancellation, so the contract is just "wait for a slot, then release it". loaders.gl's `RequestScheduler.scheduleRequest(handle, getPriority?)` isn't structurally assignable to this, so `@developmentseed/deck.gl-raster` wraps it in a ~2-line adapter (see below) — geotiff stays loaders.gl-free.

### 2. An internal limiter middleware

```ts
import type { SourceMiddleware } from "@chunkd/source";

/** chunkd middleware: hold a {@link ConcurrencyLimiter} slot for the duration
 *  of each underlying `fetch`. */
function limiterMiddleware(limiter: ConcurrencyLimiter): SourceMiddleware {
  return {
    name: "concurrency-limiter",
    async fetch(req, next) {
      const release = await limiter.acquire();
      try {
        return await next(req);
      } finally {
        release();
      }
    },
  };
}
```

Internal (not exported from `index.ts`) for now.

### 3. `concurrencyLimiter` option on `GeoTIFF.open` / `fromUrl`

A new optional field, `concurrencyLimiter?: ConcurrencyLimiter`. When present, `GeoTIFF.open` / `fromUrl` append `limiterMiddleware(concurrencyLimiter)` to each source's middleware stack — **innermost** (last), after chunking and caching: header source `[SourceChunk(64 KiB), SourceCache(…), limiterMW]`, data source `[limiterMW]`. Innermost so a cache hit short-circuits before reaching the limiter (a cache hit is not an HTTP request and must not burn a slot), and a chunk-expanded read takes one slot for the single (block-sized) request it actually becomes. `fetchTile` / `fetchTiles` / `coalesceRanges` / `assembleTile` are **unchanged** — they call `source.fetch(...)` exactly as before; the middleware does the gating transparently.

(If the caller passes already-constructed sources to `GeoTIFF.open`, the same `concurrencyLimiter` option still applies — `open` wraps them. Exact wrapping point in `open` vs. `fromUrl` is an implementation detail.)

### 4. A `Promise.allSettled`-style batch reader for per-tile errors

`fetchTiles(xy)` today is all-or-nothing — it throws on the first sparse/missing tile. For the layer path we want a viewport to survive a bad tile: add a settled variant that returns one result *or error* per requested coordinate, in input order:

```ts
fetchTilesSettled(self, xy[], options?) : Promise<Array<Tile | { error: unknown }>>
```

(Name/shape provisional — could equally be `fetchTiles(xy, { onError: "collect" })`. Decided in the plan.) Implementation composes the pieces [#531](https://github.com/developmentseed/deck.gl-raster/pull/531) already separated: one coalesced byte fetch (`getTiles` — still all-or-nothing at the *network* level: a `fetch` failure inside a merged range dooms every tile whose bytes were in that range, unavoidable with coalescing → those tiles all get that error), then `assembleTile` per tile wrapped in `try/catch` so per-tile decode errors / sparse tiles land in only that tile's slot. `getTiles` / `assembleTile` may need to be exported package-internally (they currently are) or lifted slightly — implementation detail.

## `@developmentseed/deck.gl-raster` changes

### 1. New `getMultiTileData` prop + accessor

```ts
// on RasterTileLayerProps:
getMultiTileData?: (
  image: ImageT,                 // overview or primary, resolved by z
  tiles: Tile[],                 // all share z (same IFD); same source
  opts: { signal: AbortSignal; device: Device; pool: DecoderPool },
) => Promise<Array<DataT | Error>>;   // aligned with `tiles`, in order
```

Sourced via a new `protected _getMultiTileDataCallback()` accessor, mirroring `_getTileDataCallback()` / `_renderTileCallback()`. Returns `undefined` if neither the prop nor a subclass default is set. No limiter in `opts` — it's invisible to the callback, baked into the GeoTIFF's sources. (Forward-compat: if deck.gl upstreams `getTileDataBatched` and passes its `_requestScheduler` in opts, we can ignore it — our gating is at the source layer — or honor it; minor.)

### 2. Branch in `_renderTileLayer`

```
const multi = this._getMultiTileDataCallback();
if (!multi) {
  // unchanged from today
  innerTileLayer.getTileData  = tile => this._wrapGetTileData(tile, getTileData);
  innerTileLayer.maxRequests  = this.props.maxRequests;       // straight through
} else {
  const limiter = this.state.concurrencyLimiter;                  // created in updateState; see §4
  const batcher = this.state.tileBatcher;                     // wraps `multi`
  innerTileLayer.getTileData  = tile => batcher.fetch(tile);
  innerTileLayer.maxRequests  = 0;                            // deck.gl's per-tile throttle off
}
```

The no-batched-callback path is byte-for-byte today's. `maxRequests: 0` also disables `_pruneRequests` — fine: coalesced requests don't hit the connection limit, and per-tile aborts are still honored by the batcher.

### 3. `TileBatcher`

A small class (not a layer), one instance per `RasterTileLayer` (lifecycle-tied to the inner `TileLayer` / created in `updateState` when `multi` first becomes available, finalized with the layer).

- `fetch(tile, { signal }): Promise<DataT>` — push `{ tile, signal, resolve, reject }` onto a buffer; if the buffer was empty, arm `setTimeout(flush, 0)`. Return the promise. (`setTimeout(0)` deterministically fires after deck.gl's synchronous burst of `getTileData` calls + their microtask tail — see "Timing" below.) The `0` is an internal constant, not a public prop — the timing analysis shows it's sufficient, so there's nothing to tune; if a future deck.gl change makes a small delay useful it can be promoted to a prop then.
- `flush()` — drain the buffer; drop any entry whose `signal` is already aborted (reject it with the abort reason); group the rest by `(sourceId, z)` — for `COGLayer`, `sourceId` is constant (one COG) and `z` selects overview vs. primary, resolved to `image` once per group using the same logic `_wrapGetTileData` uses; for each group: build a **composite `AbortSignal`** that aborts only when *every* member tile's signal has aborted, call `getMultiTileData(image, groupTiles, { signal: composite, device, pool })`; on resolve, for each `i`: if `results[i]` is an `Error` (or the tile's signal aborted post-dispatch) reject `groupTiles[i].reject(...)`, else `groupTiles[i].resolve(results[i])`; on reject, reject every tile in the group with the error. All groups dispatched concurrently — the source-level `ConcurrencyLimiter` does the limiting.
- On layer finalize — reject every still-buffered entry with an abort reason; arm no further timers.

Composite-signal helper: track a remaining count = group size; on each member signal's `abort`, decrement; at zero, abort a fresh `AbortController` and pass *its* signal to `getMultiTileData`. (This is the main reason a future `maxTilesPerBatch` cap is worth having — a huge group means many tiles share one all-or-nothing fetch and one composite signal.)

### 4. loaders.gl `RequestScheduler` → `ConcurrencyLimiter` adapter

Promote `@loaders.gl/loader-utils` to an explicit dependency of `@developmentseed/deck.gl-raster` (currently transitive via deck.gl). In `updateState`, when `multi` becomes available, create a loaders.gl `RequestScheduler` and adapt it to geotiff's `ConcurrencyLimiter`:

```ts
const ls = new RequestScheduler({ maxRequests: this.props.maxRequests });
const concurrencyLimiter: ConcurrencyLimiter = {
  acquire: () =>
    // fresh {} per call — loaders.gl dedupes by handle identity, so reusing one
    // would collapse all requests into a single slot.
    ls.scheduleRequest({}).then((tok) => () => tok?.done()),
};
```

Store `ls` (so `setProps` can update `maxRequests`), `concurrencyLimiter` (the adapter), and the `tileBatcher` in layer state. The subclass that opens the GeoTIFF threads `concurrencyLimiter` into `GeoTIFF.open` (see deck.gl-geotiff changes). If `props.maxRequests` is `0`/falsy, `RequestScheduler` is un-throttled (no cap) — which is the right behavior (the user asked for unlimited). *(`scheduleRequest` can in principle resolve to `null` if a request is cancelled via a priority callback; we never pass one, so it never happens — the `tok?.done()` just makes the adapter total.)*

## `@developmentseed/deck.gl-geotiff` changes

- `COGLayer` provides a default `getMultiTileData` (via overriding `_getMultiTileDataCallback()` analogously to `_getTileDataCallback()`): resolve the batch's `xy` from `tiles`, call `geotiff.fetchTilesSettled(xy, { signal, pool })`, map each `Tile` → run the existing decode/render path → `DataT`, and each `{ error }` → that `Error`. Keeps its existing default `getTileData` → `geotiff.fetchTile` unchanged.
- In `updateState`, pass `concurrencyLimiter: this.state.concurrencyLimiter` (created by the `RasterTileLayer` base in its `updateState`) into `GeoTIFF.open(...)`. Ordering: `RasterTileLayer.updateState` must create the limiter before `COGLayer.updateState` opens the GeoTIFF — e.g. `COGLayer.updateState` calls `super.updateState()` first, or the limiter is created in a base helper invoked early. Implementation detail for the plan.

## Timing — why `setTimeout(flush, 0)`

The JS event loop runs one **macrotask** at a time (a `setTimeout` callback, an event handler, …); after *each* macrotask it fully drains the **microtask** queue (`Promise.then` / `await` continuations, `queueMicrotask`) before the next macrotask. deck.gl's `Tileset2D._updateTileStates` synchronously spawns one `Tile2DHeader.loadData` per needed tile; with the inner layer's `maxRequests: 0`, each `loadData`'s `await scheduleRequest(...)` resolves immediately, so the continuation calling our `getTileData` runs as a microtask — therefore **every `getTileData` call for one viewport update lands within the current macrotask** (before its microtask queue drains). A `setTimeout(flush, 0)` callback is the *next* macrotask, which runs only after the current one's microtasks are all done — so it deterministically observes the whole burst. (A `queueMicrotask`-based flush would be too eager — it could fire mid-burst.) `0` is hard-coded (browsers clamp `setTimeout(0)` to ~1 ms anyway — still low-latency, still after the burst); not exposed as a prop. If a future deck.gl spreads tile requests across animation frames or the main thread is starved, a small delay would merge across those chunks — correctness degrades gracefully (more, smaller batches), not breaks — and the constant could be promoted to a prop at that point.

## Errors & edge cases

- **Per-tile failure in a batch**: surfaced — `getMultiTileData` returns `Array<DataT | Error>`; the batcher rejects only the failing tile's `getTileData` promise (deck.gl marks just that tile errored/`null`). `COGLayer`'s implementation reports per-tile decode/sparse-tile errors individually; a network failure inside a coalesced merged range dooms every tile whose bytes were in it (those get the same error) — inherent to coalescing.
- **Whole-batch failure**: `getMultiTileData` rejects ⇒ every tile in that group rejects ⇒ each marked errored/`null`, same as a per-tile `getTileData` throw today.
- **Aborts**: a tile aborted *before* flush is dropped from the batch and rejected. A tile aborted *after* dispatch is rejected (its bytes were already fetched — wasted, acceptable). The underlying coalesced fetch is aborted only when *all* tiles in its group are aborted.
- **`maxRequests: 0` on the inner layer**: also disables `_pruneRequests` (deck.gl's "abort unselected in-flight tiles past the limit") — desirable here.

## Testing

- `TileBatcher` unit tests (mock tiles/signals/`getMultiTileData`): N `fetch()` calls ⇒ one `getMultiTileData` per `(source, z)` group with the right tiles; results distributed in order; an `Error` element rejects only that tile; whole-call rejection rejects the group; pre-flush abort drops & rejects; post-flush abort rejects but doesn't abort the group; the composite signal aborts the group only when all members abort; finalize rejects buffered.
- `limiterMiddleware` unit test (mock limiter + source): `fetch` acquires a slot, calls `next`, and `release()`s in `finally` (on success and on throw); cache-hit path (no `next` call) never touches the limiter — exercised via a `[SourceCache, limiterMW]` stack with a pre-populated cache.
- `GeoTIFF.open({ concurrencyLimiter })` integration test: open a fixture with a recording-and-counting limiter; `fetchTiles` over a grid ⇒ limiter saw exactly the number of (post-coalesce) `fetch` calls; with `maxRequests: 1` it serializes them.
- `geotiff.fetchTilesSettled` test: a grid with one sparse tile ⇒ that slot is an error, the rest are `Tile`s; a network failure (mock source that throws on a particular range) ⇒ every tile whose bytes were in that merged range is an error.
- `COGLayer._getMultiTileDataCallback` default: calls `geotiff.fetchTilesSettled` with the right `xy`/`image`; maps `Tile`→`DataT` and `{error}`→`Error`.
- loaders.gl→`ConcurrencyLimiter` adapter: fresh handle per `acquire()` (two calls aren't deduped into one slot); the returned release function `done()`s the token.
- (A full deck.gl-in-jsdom integration test — pan a `COGLayer`, count `dataSource.fetch` calls ≪ tiles — is heavy; the unit tests above cover the logic. Optional stretch if a harness exists.)

## Open questions / deferred to the plan

- Name for the settled batch reader (`fetchTilesSettled` vs. a `fetchTiles(xy, { onError: "collect" })` option).
- Exact lifecycle wiring of the limiter/batcher in `RasterTileLayer.updateState` vs. `COGLayer.updateState` (who creates, who installs, ordering).
- Whether `coalesceRanges`'s internal `COALESCE_PARALLEL` should become configurable now (the source-level limiter already caps things globally; a per-call ceiling is mostly redundant once the middleware is in place — likely leave as-is).
