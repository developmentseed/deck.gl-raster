# Coalescing tile fetches through deck.gl `getTileData` (`COGLayer`)

**Date:** 2026-05-12
**Issues:** [#273](https://github.com/developmentseed/deck.gl-raster/issues/273); related deck.gl [visgl/deck.gl#10098](https://github.com/visgl/deck.gl/issues/10098)
**Status:** Design — builds on [#531](https://github.com/developmentseed/deck.gl-raster/pull/531) (`geotiff.fetchTiles`, range-coalescing batched reader).

## Background

Two distinct (but related) problems push us to change how `COGLayer` fetches tiles:

**1. Request coalescing.** deck.gl's `TileLayer` has exactly one fetch hook, `getTileData(tile, { signal, … })`, called **once per tile**. For tile sources where each tile is a separate URL (MVT), that's unavoidable. For a COG, every tile in a viewport is a byte range of the *same* file, and adjacent tiles' ranges are contiguous (or near-contiguous) on disk — so N independent range requests could be a handful of coalesced ones. [#531](https://github.com/developmentseed/deck.gl-raster/pull/531) gave `@developmentseed/geotiff` a `fetchTiles(xy[])` that does exactly that coalescing for a *known* batch. What's missing is getting deck.gl's stream of per-tile `getTileData` calls *to* `fetchTiles`. The deck.gl-native fix — a `getTileDataBatched` prop wired into `Tileset2D` — is proposed upstream ([visgl/deck.gl#10098](https://github.com/visgl/deck.gl/issues/10098)) but has no PR and no maintainer commitment, so this lives in our packages.

**2. Concurrency capping across layers, per origin.** Most COGs we target live on AWS S3 (or similar), which serves over HTTP/1.1 only. Browsers cap concurrent HTTP/1.1 connections per origin at ~6 (Chrome: 6). If we schedule more than that, the browser queues the excess — and queued requests stick around even when the viewport pans, blocking *new* requests for the new viewport behind dead ones for the old. So we want to cap concurrent in-flight HTTP requests at the browser's limit; over-scheduling is actively harmful.

This cap can't live per-layer: two `COGLayer`s targeting the same S3 bucket would each get 6 slots → 12 in-flight → browser queues. It has to be **per origin, shared across layers and source formats** (COG today, Zarr later). deck.gl's `Tileset2D` ships an internal loaders.gl `RequestScheduler({ maxRequests: 6 })` but it's per-`TileLayer` instance, so it doesn't solve this; it also counts `getTileData` *calls* (≈ tiles), not HTTP requests — and one COG tile fetch can issue several requests (uncached metadata + tile data + mask).

The two problems are independent: coalescing is layer-scoped (which deck.gl `getTileData` calls belong in one `fetchTiles`?), gating is source-scoped (how many HTTP requests are in flight to this host?). The design treats them separately.

### How deck.gl loads tiles today (relevant facts)

- `Tileset2D` constructs a loaders.gl `RequestScheduler({ maxRequests: 6, debounceTime })`; `Tile2DHeader._loadData` does `await scheduleRequest(...)` then `await getTileData(...)`. When `maxRequests <= 0` (and `debounceTime <= 0`), throttling is off and `scheduleRequest` returns an already-resolved token.
- `Tileset2D._updateTileStates` loops over needed tile indices **synchronously**, spawning one `loadData` async per. With throttling off, each `getTileData` call is one microtask later — so the whole viewport-update burst lands within the current macrotask (before its microtask queue drains).
- `Tileset2D._pruneRequests` aborts unselected in-flight tiles when more than `maxRequests` are ongoing — a no-op when `maxRequests <= 0`.

### Current code shape

- `@developmentseed/deck.gl-raster` — `RasterTileLayer` (subclass of `CompositeLayer`) builds the inner `@deck.gl/geo-layers` `TileLayer` in `_renderTileLayer`, passing `getTileData: tile => this._wrapGetTileData(tile, getTileData)`. `_wrapGetTileData` composes `props.signal` with `tile.signal` and calls the layer's `getTileData(tile, { device, signal })`. Subclasses override `_getTileDataCallback()` to supply defaults.
- `@developmentseed/deck.gl-geotiff` — `COGLayer` extends `RasterTileLayer`; `_parseGeoTIFF()` opens a `GeoTIFF` via `fetchGeoTIFF(props.geotiff)` (which calls `GeoTIFF.fromUrl(url)` for URL inputs). `_getTileDataCallback` resolves `tile.index.z` to overview-vs-primary and calls the user/default `getTileData(image, …)` which today calls `geotiff.fetchTile`.
- `@developmentseed/geotiff` — `GeoTIFF.open({ dataSource, headerSource, concurrencyLimiter? })` (the `concurrencyLimiter?` option ships in this design — see below). `fromUrl(url)` builds the chunkd source stack and calls `open`. `fetchTile` / `fetchTiles` / `coalesceRanges` issue `dataSource.fetch(...)` calls.

## Goals

1. A `COGLayer` viewport of N tiles produces **far fewer than N HTTP requests** — adjacent tiles' byte ranges coalesced, via `geotiff.fetchTiles`.
2. **Concurrent HTTP requests to a single origin are capped at the browser's HTTP/1.1 limit**, *shared across all layers (and future source formats) targeting that origin* — so panning doesn't leave stale queued requests blocking fresh ones.
3. **Aborts on queued requests drop them** (no wasted fetch fires after the user has panned away).
4. **Zero behavior change when the batched callback isn't used**: a layer with no `getMultiTileData` takes the exact code path it does today.
5. Generic mechanism at the `RasterTileLayer` level (subclasses opt in by defining a batched callback); only `COGLayer` opts in for now.
6. No new dependency on `loaders.gl` in `@developmentseed/geotiff`; `geotiff`'s public `fetchTile` / `fetchTiles` signatures unchanged.

## Non-goals

- The deck.gl-native `getTileDataBatched` prop (upstream; out of scope here).
- `MultiCOGLayer` / `MosaicLayer` batching (the batcher's grouping key is designed to allow it later, but it isn't wired up).
- A `maxTilesPerBatch` cap (bounds how many tiles ride one all-or-nothing coalesced fetch).
- Per-tile *streaming* (`Promise<DataT>[]` so a fast tile resolves before a slow one).
- Cross-origin or per-path tuning of the default limiter (`max=6` everywhere is fine).
- Gating header/metadata reads through the limiter (they're tiny, mostly at `open` time, served from the header cache — they never compete with tile-data fetches for connections).

## Architecture

**Two independent pieces.** They can ship and be reasoned about separately.

1. **Per-origin `ConcurrencyLimiter` at the source layer** (`@developmentseed/geotiff`). A small abstract interface + a concrete `Semaphore` + a `defaultLimiterForOrigin(url)` factory that caches one limiter per origin. `GeoTIFF.fromUrl(url)` defaults its `concurrencyLimiter` to that factory's result — so two `fromUrl` calls (or any other source-level callers, including a future Zarr `fromUrl`-equivalent) targeting the same host share one cap. The limiter wraps the data source's `.fetch` via `limitFetch`; the caller's per-request `signal` is forwarded into `acquire`, so an abort while queued *drops* the request before any network fires.
2. **`TileBatcher` in the layer** (`@developmentseed/deck.gl-raster`). When `RasterTileLayer` is configured with a `getMultiTileData` callback, an internal `TileBatcher` buffers deck.gl's per-tile `getTileData` calls (caught on a `setTimeout(_, 0)` flush) and dispatches one `getMultiTileData(image, tiles[], …)` per `(source, z)` group. Results — `Array<DataT | Error>` — are distributed back. The inner `TileLayer` is given `maxRequests: 0` so the per-tile throttle steps aside and the batcher sees the whole viewport burst.

```
RasterTileLayer (getMultiTileData defined)
   inner TileLayer.maxRequests = 0
   inner TileLayer.getTileData = tile => batcher.fetch(tile)
                                            │  setTimeout(0); group by (source, z); composite signal
                                            ▼
              1× getMultiTileData(image, tiles[], { signal, device, pool }) per group
                                            │
                                            ▼
   COGLayer default ──► geotiff.fetchTilesSettled(xy)
                              │
                              ▼  dataSource.fetch(...) × few (after range coalescing)
                              │
   GeoTIFF.fromUrl(url, { concurrencyLimiter = defaultLimiterForOrigin(url) })
   data source's .fetch wrapped via limitFetch(limiter):
       const release = await limiter.acquire(signal);
       try { return await rawFetch(offset, length, { signal }) }
       finally { release() }
```

The two pieces only meet at the `getMultiTileData` callback. The batcher knows nothing about HTTP gating; the limiter knows nothing about tiles or batches. Either can be used (or removed) independently — e.g. you'd still want the per-origin limiter even without the batcher, just to keep the browser from queueing.

## `@developmentseed/geotiff` changes

### 1. `ConcurrencyLimiter` interface

```ts
/**
 * Minimal contract for capping the number of concurrent Source.fetch calls.
 * An optional `signal` lets a caller drop out of the queue if they no longer
 * need the request (e.g. the user panned away) — important on browsers, where
 * HTTP/1.1 caps concurrent connections per origin to ~6 and an overlong queue
 * from a previous viewport can starve a fresh one.
 */
export interface ConcurrencyLimiter {
  /** Acquire a slot. Resolves once a slot is free; call the returned function
   *  exactly once when the request finishes (success or failure) to release it.
   *  If `signal` aborts while queued, the promise rejects and no slot is consumed. */
  acquire(signal?: AbortSignal): Promise<() => void>;
}
```

No `unknown`, no token object, no `null` — geotiff has no notion of request identity, priority, or cancellation other than the queued-abort case. loaders.gl's `RequestScheduler.scheduleRequest(handle, getPriority?)` doesn't structurally match (its `handle` is required, and our `acquire` is signal-aware while theirs isn't), but adapting in either direction is straightforward if someone wants to.

### 2. `limitFetch`, `Semaphore`, `defaultLimiterForOrigin`

```ts
/** Wraps a Source.fetch so each call holds a limiter slot for its duration,
 *  forwarding the call's own signal so a queued abort drops the request. */
export function limitFetch(fetch: Fetch, limiter: ConcurrencyLimiter): Fetch {
  return async (offset, length, options) => {
    const release = await limiter.acquire(options?.signal);
    try {
      return await fetch(offset, length, options);
    } finally {
      release();
    }
  };
}

/** Concrete FIFO implementation; queued acquires that abort are removed from
 *  the queue before any request is issued. */
export class Semaphore implements ConcurrencyLimiter { /* … */ }

/** Returns a shared Semaphore for `url`'s origin (cached across calls).
 *  Default maxRequests = 6 — Chrome's HTTP/1.1 per-origin cap. Multiple
 *  fromUrl calls (and any other source-level callers) targeting the same
 *  host share one cap. */
export function defaultLimiterForOrigin(url: string | URL): ConcurrencyLimiter;
```

The interface type and the two helpers are exported from the package's public surface so app code (or a future Zarr package) can share the per-origin limiter directly. `limitFetch` is also exported so callers can apply gating to their own sources without going through `GeoTIFF.open`.

### 3. `concurrencyLimiter` option on `GeoTIFF.open` / `fromUrl`

`open` accepts `concurrencyLimiter?: ConcurrencyLimiter`. When provided, the data source's `.fetch` is wrapped via `limitFetch` — a single-line conceptual change; no `SourceView` middleware machinery, no chunkd-vs-cogeotiff `Source` type juggling. Only `.fetch` is needed from the data source, so a thin `{ fetch: limitFetch(...) }` object suffices.

`fromUrl` accepts `concurrencyLimiter?: ConcurrencyLimiter | null`. Its default behavior is the key piece: **when omitted, `fromUrl` calls `defaultLimiterForOrigin(url)`** so a per-origin cap is on by default. Pass an explicit limiter to override; pass `null` to disable gating entirely.

Header/metadata reads are not gated — they're a small handful at `open` time, then served from the block cache; gating them buys nothing and would require either a chunkd `SourceMiddleware` (impedance with cogeotiff's `Source` typing) or a Proxy. Out of scope.

`fetchTile` / `fetchTiles` / `coalesceRanges` / `assembleTile` are **unchanged** — they call `source.fetch(...)` as before; gating is invisible to them.

### 4. `fetchTilesSettled` — a `Promise.allSettled`-style batch reader

`fetchTiles(xy)` today is all-or-nothing: it throws on the first sparse/missing tile. The layer path wants a viewport to survive a bad tile. Add a settled variant returning one result *or error* per requested coordinate, in input order:

```ts
type SettledTile = Tile | { error: unknown };
fetchTilesSettled(self, xy[], options?) : Promise<SettledTile[]>;
```

Implementation composes #531's already-split pieces: one coalesced byte fetch (still all-or-nothing *at the network level* — a `fetch` failure inside a merged range dooms every tile whose bytes were in it; inherent to coalescing), then `assembleTile` per tile wrapped in `try/catch` so per-tile decode errors / sparse tiles land in just that slot. A sparse tile (bytes `null`) maps to that slot's `{ error }`.

## `@developmentseed/deck.gl-raster` changes

### 1. New `getMultiTileData` prop + `_getMultiTileDataCallback()` accessor

```ts
// on RasterTileLayerProps:
getMultiTileData?: (
  tiles: TileLoadProps[],
  options: { device: Device; signal?: AbortSignal },
) => Promise<Array<DataT | Error>>;   // aligned with `tiles`, in order
```

Sourced via a new `protected _getMultiTileDataCallback()` accessor, mirroring `_getTileDataCallback()` / `_renderTileCallback()`. Returns `undefined` if neither the prop nor a subclass default is set. The base-class signature receives `tiles: TileLoadProps[]` (deck.gl's tile shape); a subclass like `COGLayer` overrides `_getMultiTileDataCallback` to wrap a domain-specific signature (`(image, tiles, …)`) that resolves the group's shared `z` to an `image`. (All tiles in one dispatch share `z` — guaranteed by the batcher's `groupKey`.)

### 2. Branch in `_renderTileLayer`

```
const multi = this._getMultiTileDataCallback();
if (!multi) {
  // byte-for-byte unchanged from today
  innerTileLayer.getTileData = tile => this._wrapGetTileData(tile, getTileData);
  innerTileLayer.maxRequests = this.props.maxRequests;
} else {
  innerTileLayer.getTileData = tile => batcher.fetch(tile, { signal: tile.signal });
  innerTileLayer.maxRequests = 0;   // deck.gl's per-tile throttle steps aside
}
```

The no-batched-callback path is byte-for-byte today's. `maxRequests: 0` also disables `_pruneRequests`, which is fine: coalesced requests don't hit the connection limit (the per-origin limiter does), and per-tile aborts are still honored by the batcher's composite signal.

The layer **does not own or create a limiter**. The per-origin shared limiter lives at the source layer (geotiff). Two consequences:

- The user's `maxRequests` prop on `RasterTileLayer` keeps its today's meaning *only* in the no-`getMultiTileData` branch. In the batched branch it's overridden to `0` (the actual cap is at the source layer). Document this.
- No `@loaders.gl/loader-utils` dependency is added.

### 3. `TileBatcher`

A small generic class (not a layer), one instance per `RasterTileLayer`. Created lazily when `_getMultiTileDataCallback()` first returns non-undefined; finalized with the layer.

- `fetch(item, { signal }) → Promise<TResult>` — push `{ item, signal, resolve, reject }` onto a buffer; if the buffer was empty, arm `setTimeout(flush, 0)`. Return the promise.
- `flush()` — drain the buffer; drop entries whose `signal` is already aborted (reject them); group the rest by an opaque `(item) => string` `groupKey` (for `COGLayer`: `\`z${tile.index.z}\``); for each group: build a **composite `AbortSignal`** that fires only when *every* member's signal has aborted, call `dispatch(key, items, { signal: composite })` (the supplied "do one batched call" function); on resolve, distribute per-element results (`Error` instances → reject only that slot; values → resolve); on reject, reject every slot. Dispatch all groups concurrently — the source-level limiter is the cap.
- `finalize()` — reject everything buffered and arm no further timers.

The `dispatch` callback (supplied by `RasterTileLayer` when it constructs the batcher) is the bridge from "per-tile" to "per-source-format batched": it calls `_getMultiTileDataCallback()` (resolved to whatever the subclass returns) with the right shape, composing layer-level `props.signal` with the batcher's composite per-group signal.

`setTimeout(flush, 0)`: hard-coded `0`, not exposed. The timing analysis (next section) shows it's sufficient.

## Timing — why `setTimeout(flush, 0)`

The JS event loop runs one **macrotask** at a time; after each macrotask it fully drains the **microtask** queue before the next macrotask. deck.gl's `Tileset2D._updateTileStates` synchronously spawns one `Tile2DHeader.loadData` per needed tile; with the inner layer's `maxRequests: 0`, each `loadData`'s `await scheduleRequest(...)` resolves immediately, so the continuation calling our `getTileData` runs as a microtask — therefore **every `getTileData` call for one viewport update lands within the current macrotask** (before its microtask queue drains). A `setTimeout(flush, 0)` callback is the *next* macrotask, which runs only after the current one's microtasks are all done — so it deterministically observes the whole burst. (A `queueMicrotask`-based flush would be too eager — it could fire mid-burst.) Browsers clamp `setTimeout(0)` to ~1 ms anyway — still low-latency, still after the burst.

## `@developmentseed/deck.gl-geotiff` changes

- `COGLayer` provides a default `getMultiTileData` (via overriding `_getMultiTileDataCallback()`): resolve the batch's `xy` from `tiles`, resolve the group's shared `z` to `image` (overview vs primary), call `geotiff.fetchTilesSettled(xy, { signal, pool })`, map each `Tile` → run the existing decode/render path → `DataT`, and each `{ error }` slot → that `Error`. Keeps its existing default `getTileData` → `geotiff.fetchTile` unchanged.
- **No limiter wiring.** `fetchGeoTIFF(props.geotiff)` already calls `GeoTIFF.fromUrl(url)` which defaults the limiter to the shared per-origin one. Nothing for `COGLayer` to thread.

## Errors & edge cases

- **Per-tile failure in a batch**: surfaced — `getMultiTileData` returns `Array<DataT | Error>`; the batcher rejects only the failing tile's `getTileData` promise (deck.gl marks just that tile errored/`null`). `COGLayer`'s implementation reports per-tile decode/sparse-tile errors individually; a network failure inside a coalesced merged range dooms every tile whose bytes were in it (those get the same error) — inherent to coalescing.
- **Whole-batch failure**: `getMultiTileData` rejects ⇒ every tile in that group rejects, same as a per-tile `getTileData` throw today.
- **Aborts**: a tile aborted *before* flush is dropped from the batch and rejected. A tile aborted *after* dispatch is rejected (bytes already fetched — wasted, acceptable). The underlying coalesced fetch is aborted only when *all* tiles in its group are aborted. A queued limiter `acquire` whose signal aborts is dropped — no request fires.
- **`maxRequests: 0` on the inner layer** also disables `_pruneRequests` (deck.gl's "abort unselected in-flight tiles past the limit") — desirable here.

## Testing

- `limiter.test.ts` — `limitFetch` (slot held for fetch lifetime on success and on throw; forwards offset/length/options; forwards caller's signal so a queued abort drops the request); `Semaphore` (max concurrency, FIFO, queued abort drops without consuming a slot, pre-aborted signal rejects immediately, `RangeError` on bad construction); `defaultLimiterForOrigin` (same instance for same origin, distinct for distinct origins, accepts `URL` object).
- `geotiff-concurrency-limiter.test.ts` — `GeoTIFF.open({ concurrencyLimiter })` integration: tile-data fetches go through the limiter, header reads don't, 1-slot smoke, no-limiter smoke.
- `fetchTilesSettled` — good grid: same as `fetchTiles` (no `{ error }` slots); band-separate good grid: same; one sparse tile: that slot is `{ error }`, others are `Tile`s; empty input: `[]`.
- `TileBatcher` unit tests — N `fetch()` calls ⇒ one `dispatch` per group key with the right items; per-item `Error` rejects only that slot; whole-dispatch rejection rejects the group; pre-flush abort drops & rejects; post-flush abort rejects but doesn't abort the group; composite signal aborts the group only when all members abort; `finalize()` rejects buffered.
- `COGLayer._getMultiTileDataCallback` default: calls `geotiff.fetchTilesSettled` with the right `xy`/`image`; maps `Tile` → `DataT` and `{ error }` → `Error`.

## Open questions / deferred to the plan

- Exact lifecycle wiring of the batcher in `RasterTileLayer.updateState` / `finalizeState` vs. `COGLayer.updateState`.
- Whether `coalesceRanges`'s internal `COALESCE_PARALLEL` should become configurable (the per-origin source-level limiter already caps globally; a per-call ceiling is likely redundant — lean toward leaving as-is).
