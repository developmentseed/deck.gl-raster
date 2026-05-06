# GeoTIFF exponential read-ahead cache

**Date:** 2026-05-05 (revised 2026-05-06)
**Issue:** [#500](https://github.com/developmentseed/deck.gl-raster/issues/500)
**Status:** Initial implementation in PR [#509](https://github.com/developmentseed/deck.gl-raster/pull/509); follow-up refinements specified below.

## Problem

When opening a GeoTIFF over HTTP, [`GeoTIFF.fromUrl`](../../packages/geotiff/src/geotiff.ts) wraps the source with chunkd's `[SourceChunk, SourceCache]` middleware pair. `SourceChunk` aligns each request to a fixed `chunkSize` (default 32 KiB) and is stateless: every fetch uses the same chunk size regardless of how many fetches preceded it.

For TIFF metadata reads — IFD chains, tag values, GeoKeys, GDAL metadata — access is sequential from the start of the file, but the size of metadata varies widely between files (small COGs may fit in 16 KiB; files with many IFDs or large tag arrays may need 1+ MiB). A fixed chunk size is the wrong shape: too small means many round trips, too large means wasted bytes for small files.

## Solution

Replace the `[SourceChunk, SourceCache]` pair on the header source with a single new middleware that maintains a **sequential read-ahead cache** rooted at offset 0. Each underlying fetch grows by a configurable multiplier, so successive metadata reads use exponentially larger chunks.

This is a direct port of [async-tiff's `ReadaheadMetadataCache`](https://github.com/developmentseed/async-tiff/blob/3dd77e3/src/metadata/cache.rs) ([PR #140](https://github.com/developmentseed/async-tiff/pull/140)) to TypeScript and to the chunkd `SourceMiddleware` interface.

### Why sequential-from-zero?

TIFF metadata is laid out near the start of the file: header → IFD → tag values → next IFD → … . Cogeotiff's reads land in this region. A cache that grows contiguously from offset 0 captures every metadata read with at most one underlying fetch beyond what the previous read already pulled in. Tile data reads, by contrast, are at arbitrary large offsets — those continue to use the raw `dataSource` with no caching, exactly as they do today.

## Components

All new code lives under `packages/geotiff/src/`.

### `concurrency.ts` — `mutex()`

A standalone helper that returns a function for running async tasks one at a time. Used by the read-ahead cache to serialize cache extension across concurrent fetches.

```ts
/**
 * Create a mutex: a function that runs async tasks one at a time.
 *
 * Tasks submitted while another is running are queued and executed in
 * submission order — never concurrently with each other.
 *
 * Useful when an async operation must observe and mutate shared state
 * across awaits without races. The TypeScript analogue of holding a
 * `tokio::sync::Mutex` across an `await`.
 *
 * @example
 * const lock = mutex();
 * const a = lock(async () => { ... });  // executes immediately
 * const b = lock(async () => { ... });  // waits for `a` to settle, then runs
 *
 * @returns A function that schedules tasks on the queue.
 */
export function mutex(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => {});
    return result;
  };
}
```

Notes:
- `tail.then(task, task)` ensures the next task runs whether the previous task resolved or rejected.
- `tail = result.catch(() => {})` swallows errors only on the queue chain, not on the returned promise — the caller still observes the original rejection.
- No timeouts, no cancellation. Keep it minimal.

### `readahead-cache.ts`

Two pieces in one file. Internal — not exported from `index.ts`.

#### `SequentialBlockCache` (internal helper class)

Stores contiguous buffers from offset 0.

- Fields: `buffers: Uint8Array[]`, `len: number` (sum of buffer lengths).
- `contains(start, end)` → `boolean`. True iff `end <= len`.
- `slice(start, end)` → `ArrayBuffer`. Crosses block boundaries when needed; returns a zero-copy slice when the range fits in one block.
- `appendBuffer(buf: ArrayBuffer)` → mutates.

#### `SourceReadaheadCache` (the middleware)

Implements chunkd's [`SourceMiddleware`](../../packages/geotiff/node_modules/@chunkd/source/build/src/middleware.d.ts) interface (`{ name, fetch(req, next) }`).

- Constructor options: `{ initial: number; multiplier: number }`.
- Fields: `cache: SequentialBlockCache`, `initial`, `multiplier`, `lock: ReturnType<typeof mutex>`.
- `fetch(req, next)`:
  1. If `req.offset < 0` or `req.length == null`, bypass: `return next(req)`.
  2. Inside `this.lock(...)`:
     - While `!cache.contains(req.offset, req.offset + req.length)`:
       - `needed = req.offset + req.length - cache.len`.
       - `fetchSize = max(nextFetchSize(cache.len), needed)`, clamped against `req.source.metadata?.size - cache.len` if known.
       - `buf = await next({ ...req, offset: cache.len, length: fetchSize })`.
       - If `buf.byteLength === 0`, break (EOF).
       - `cache.appendBuffer(buf)`.
     - Return `cache.slice(req.offset, req.offset + req.length)`.
- `nextFetchSize(existingLen)`: `existingLen === 0 ? initial : round(existingLen * multiplier)`.

### Wiring in `geotiff.ts`

Update [`GeoTIFF.fromUrl`](../../packages/geotiff/src/geotiff.ts):

- New options shape (breaking):
  ```ts
  {
    prefetch?: number;     // default 32 * 1024
    multiplier?: number;   // default 2.0
  }
  ```
- Drop `chunkSize` and `cacheSize`.
- Replace `[new SourceChunk({ size: chunkSize }), new SourceCache({ size: cacheSize })]` with `[new SourceReadaheadCache({ initial: prefetch, multiplier })]`.
- Continue passing `prefetch` to `Tiff.create({ defaultReadSize: prefetch })` via `GeoTIFF.open`, so the very first read is correctly sized.
- Update JSDoc on `fromUrl` to describe the new behavior.

`GeoTIFF.open` and `GeoTIFF.fromArrayBuffer` are unchanged. Memory sources don't need read-ahead, and `open` callers compose their own middleware.

## Tests

### `concurrency.test.ts`

- Tasks run one at a time (use a "concurrent counter" to detect overlap).
- Submission order is preserved.
- A rejecting task does not block subsequent tasks.
- Each call's result/error is delivered to the right caller.

### `readahead-cache.test.ts`

Port the async-tiff unit tests:

- Initial fetch returns the requested range; underlying fetch count = 1.
- Subsequent fetch within the cached range: count unchanged.
- Fetch exceeding cached range: count + 1; growth size matches `initial * multiplier^n` (use `initial=2, multiplier=3` like the upstream test).
- Fetch larger than `initial * multiplier^n` triggers a single fetch sized to `needed`.
- `SequentialBlockCache.contains`/`slice` works across multiple blocks, including empty buffers and EOF (port `test_sequential_block_cache_empty_buffers`).
- Concurrent test: fire N parallel `fetch` calls and assert the cache only grows by the expected number of underlying fetches (i.e. requests overlap correctly via the mutex).

### Smoke test against `GeoTIFF.fromUrl`

Mock a `Source.fetch` with a counter and assert that opening a real fixture takes fewer underlying calls than the previous `[SourceChunk, SourceCache]` pipeline.

## Out of scope

- No upstream PR to `@chunkd/middleware`.
- No public export of `SourceReadaheadCache`, `SequentialBlockCache`, or `mutex` (per "minimal public APIs" preference). Easy to expose later if a concrete external use case appears.
- No backwards-compatibility shim for `chunkSize` / `cacheSize` — this is a 0.x package and release-please will surface the breaking change.
- No timeouts or cancellation in `mutex()`.
- No per-source registry — one middleware instance is created per `fromUrl` call and tied to that source's lifetime, same as the existing `SourceChunk`/`SourceCache` lifecycle.

## Revision (2026-05-06): scope cache to the open phase

After live-testing PR [#509](https://github.com/developmentseed/deck.gl-raster/pull/509) against the land-cover example, the readahead cache caused catastrophic over-fetching when zooming. The middleware was being consulted *throughout the lifetime* of the `Tiff` instance — not just during initial `Tiff.create()` — because cogeotiff/core lazily reads tile metadata from the `headerSource` whenever a tile from a previously-untouched IFD is requested.

Concretely, with default settings, panning the land-cover fixture issued underlying fetches of 14 MiB, 42 MiB, 127 MiB, 382 MiB. Each new far-offset request landed past `cache.len`, and the exponential growth (`fetchSize = round(cache.len * multiplier)`) blew up.

### Root causes

1. **cogeotiff lazy IFD reads.** When `Overview.fetchTile()` runs against an IFD whose tag values weren't bulk-read at open time, cogeotiff issues per-entry 4–8 byte reads against the `headerSource` for `TileOffsets`/`TileByteCounts`. Today's [`prefetchTags`](../../packages/geotiff/src/ifd.ts) only runs on the *primary* image — overviews and masks are not prefetched.
2. **Cache strategy mismatch.** `SourceReadaheadCache` is a sequential-from-zero cache. It's right for the open phase (IFDs and tag values cluster near the start of the file), but wrong for arbitrary-offset reads after open. Each far-offset request pulls the cache forward exponentially.
3. **Initial size too small for some files.** Default `prefetch = 32 KiB` requires 3 underlying fetches even for moderate metadata. geotiff.js uses 65536 (64 KiB) blocks; async-tiff uses 32 KiB.

### Decisions

1. **The readahead cache runs *only during the open phase*.** After `Tiff.create()` and the initial `prefetchTags(primaryImage)` complete, `SourceReadaheadCache.disable()` is called. From that point on, every call to `SourceReadaheadCache.fetch(req, next)` short-circuits to `next(req)` — the cache is neither consulted nor extended. Cogeotiff still holds a reference to the wrapped `SourceView`, but the middleware becomes a no-op pass-through. We do not mutate the `Tiff` instance; we don't need to.
2. **Lazy per-IFD bulk prefetch on first tile request.** Each `Overview` lazily triggers a one-shot bulk read of `TileOffsets` + `TileByteCounts` (via cogeotiff's `image.fetch(TiffTag.…)` API) on its first `fetchTile`. The overview caches the resulting promise so concurrent first-tile requests share a single underlying fetch. Since these calls happen post-`disable()`, they bypass the readahead cache and go straight to raw HTTP — exactly one bulk request per array, per overview.
3. **Default `prefetch` bumped from 32 KiB to 64 KiB.** Aligns with geotiff.js's default block size; cuts one round trip on moderately-sized COGs without measurably penalizing tiny ones. The multiplier dominates open-time round-trip count, but a slightly larger initial moves us closer to one-shot opens for typical files.
4. **Background pre-warming is *not* in scope.** Hooking into `onTilesLoaded` to prefetch unvisited overviews is appealing but adds scheduling complexity. Track as a follow-up issue once the lazy mechanism above is in place — it can be layered on by calling the same per-IFD prefetch path opportunistically.

### `SourceReadaheadCache.disable()` contract

```ts
class SourceReadaheadCache implements SourceMiddleware {
  // ...
  /**
   * Permanently bypass the cache.
   *
   * After this is called, every {@link fetch} returns `next(req)` immediately
   * — no cache consultation, no cache extension. Existing in-flight requests
   * complete normally (the mutex preserves serialization).
   *
   * Intended to be called once `GeoTIFF.fromUrl` has finished its open-phase
   * reads (`Tiff.create` + `prefetchTags(primaryImage)`). At that point the
   * readahead cache has done its job; subsequent reads from cogeotiff are at
   * arbitrary offsets (lazy IFD lookups, GDAL ghost-header probes) and do
   * not benefit from sequential-from-zero growth.
   *
   * Idempotent. One-way: there is no `enable()`.
   */
  disable(): void;
}
```

### Per-overview lazy prefetch contract

`Overview.fetchTile` becomes:

```ts
async fetchTile(x, y, options): Promise<Tile> {
  await this.ensureTagsLoaded();  // memoized; resolves once
  return /* existing fetch path */;
}

private ensureTagsLoaded(): Promise<void> {
  if (!this._tagsPromise) {
    this._tagsPromise = Promise.all([
      this.dataImage.fetch(TiffTag.TileOffsets),
      this.dataImage.fetch(TiffTag.TileByteCounts),
      this.maskImage?.fetch(TiffTag.TileOffsets) ?? Promise.resolve(null),
      this.maskImage?.fetch(TiffTag.TileByteCounts) ?? Promise.resolve(null),
    ]).then(() => undefined);
  }
  return this._tagsPromise;
}
```

`Overview.fetchTiles` calls `ensureTagsLoaded` once before launching parallel tile fetches. The primary image's `GeoTIFF.fetchTile` doesn't need this — `prefetchTags` has already loaded those tags during open.

### Tests

Update existing tests and add new ones:
- `readahead-cache.test.ts`: add a test for `disable()` — fetches before disable hit the cache normally; fetches after disable always pass through, never grow `cache.len`.
- `integration-readahead.test.ts`: add an assertion that after open, simulated tile-offset reads at far offsets do *not* trigger cache growth (count underlying fetches; there should be one fetch per requested tag, not exponential growth).
- New: `overview.test.ts` (or extend an existing test): assert that the second tile request from an overview does not trigger any new underlying tag fetches (i.e. `ensureTagsLoaded` is memoized).

## References

- Issue: [developmentseed/deck.gl-raster#500](https://github.com/developmentseed/deck.gl-raster/issues/500)
- Initial PR: [developmentseed/deck.gl-raster#509](https://github.com/developmentseed/deck.gl-raster/pull/509)
- Reference implementation: [developmentseed/async-tiff PR #140](https://github.com/developmentseed/async-tiff/pull/140), file [`src/metadata/cache.rs`](https://github.com/developmentseed/async-tiff/blob/3dd77e3/src/metadata/cache.rs)
- Existing source pipeline: [`packages/geotiff/src/geotiff.ts:233-262`](../../packages/geotiff/src/geotiff.ts#L233-L262)
- chunkd `SourceMiddleware` interface: `@chunkd/source/build/src/middleware.d.ts`
