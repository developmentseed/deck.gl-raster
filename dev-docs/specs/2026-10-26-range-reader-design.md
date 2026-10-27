# Range Reader: Streamed, Coalesced Byte Ranges for COGs

- **Date:** 2026-10-26
- **Issues:** [#273](https://github.com/developmentseed/deck.gl-raster/issues/273) (batch tile reads; this design needs no deck.gl change), [#747](https://github.com/developmentseed/deck.gl-raster/issues/747) (gap default and the request-count model), [#762](https://github.com/developmentseed/deck.gl-raster/issues/762) (re-fetch of bytes already downloaded), [#690](https://github.com/developmentseed/deck.gl-raster/issues/690) (one tile's abort must never fail another), [#524](https://github.com/developmentseed/deck.gl-raster/issues/524) (`Content-Range` hidden by CORS), [#709](https://github.com/developmentseed/deck.gl-raster/pull/709) (our header cache middleware; replaced here)
- **Status:** Draft for review; three PRs, then a release; Zarr follows in a later release

Code links are pinned to main at
[`48141bb7`](https://github.com/developmentseed/deck.gl-raster/commit/48141bb7b8ced5f871eae1ddf58fa1170068a776)
and to kylebarron/usgs-topo at
[`f706675b`](https://github.com/kylebarron/usgs-topo/commit/f706675b426ec01a7620dcad96a12a028bafc0c1).

## Problem

A COG layer fetches every tile with its own HTTP range request. S3 and most
object stores speak HTTP/1.1 to browsers, which allow six connections per
origin, so a view of a hundred tiles is a hundred round trips through six
lanes. The smaller the tiles, the worse it gets: the USGS historical topo
sheets use 128 x 128 tiles, and in the usgs-topo mosaic app a zoom-12 view
costs 226 requests and 4.19 s on a 2x screen, 673 requests and 13.4 s on 4x.
Panning back over tiles that were already downloaded fetches them again
(#762), because tile bytes are never cached.

The client knows the file layout. It has the tile offset table, so it knows
that the tiles it wants are a few contiguous runs of bytes. A tile server
cannot do this, since its client only knows tile addresses. Range coalescing
is the one place where client-side reading is strictly better informed than a
server-side tiler, and we are not using it.

The usgs-topo prototype ([PR #23](https://github.com/kylebarron/usgs-topo/pull/23),
[`batching-source.ts`](https://github.com/kylebarron/usgs-topo/blob/f706675b426ec01a7620dcad96a12a028bafc0c1/src/map/batching-source.ts),
[`merge-reads.ts`](https://github.com/kylebarron/usgs-topo/blob/f706675b426ec01a7620dcad96a12a028bafc0c1/src/map/merge-reads.ts))
proved that merging the reads of one task into few range requests cuts the
same views to 30 requests and 0.79 s, and 53 requests and 1.38 s, with
pixel-identical output. It held back in two places: it capped merged requests
at 512 KiB, because a merged request runs to the end while any tile in it is
still wanted, and it discarded the bytes between tiles.

## What changed: streaming

The prototype buffered each merged response and sliced it at the end. Instead,
read the response body as a stream and resolve each tile the moment its last
byte has arrived. That removes the reasons to hold back:

- **Time to first tile stays flat.** The first tile in a merged request
  resolves as soon as its bytes pass, not when the whole request finishes.
  Larger merges no longer delay the first paint.
- **Cancellation is cheap and exact.** When the tiles still wanted all lie
  behind the stream position, or no tile is wanted at all, the stream is
  cancelled at once. The prototype's fast-pan waste (2.2 MB versus 1.4 MB on
  ten quick pans) came from running merged requests to completion.
- **Bytes already received are never wasted.** Everything that has arrived,
  including the gaps between tiles and the prefix of a cancelled stream, goes
  into a byte cache keyed by file offset. A pan that wants a tile inside a
  previous merged request is served from memory. Over-fetch turns from waste
  into prefetch, bounded by a cap the user controls.
- **Header reads use the same path.** cogeotiff reads tile offsets one entry
  at a time after open, so the header is read back into for as long as the
  file is in use. Those reads go through the same reader and the same cache,
  with their own budget, replacing the chunking and LRU middleware we have
  today.

Kyle's conclusion: with streaming there is no reason not to coalesce COG
requests by default.

## Decided

Kyle's decisions, from the brainstorm on 2026-10-26:

- Coalesce COG tile reads by default, as streamed range requests, resolving
  each read as its bytes arrive. Cancel a stream on the fly when nothing ahead
  is wanted, and keep what arrived.
- One byte cache for header and tile bytes. Header bytes are protected from
  tile churn by a separate budget, not pinned forever: a 150 GB COG has tens of
  MB of offset tables and must not keep all of them resident.
- Arrival in file order (top-down scanlines inside one file) is acceptable.
  Spiral-out loading existed because tiles were one request each. deck.gl's
  own distance ordering stays as it is.
- The over-fetch default is decided after the first implementation, by
  measurement. A user-controllable cap on over-fetch is required from the
  start, and the library must never over-fetch by hundreds of MB.
- Custom request parameters (headers, credentials) are supported, so data
  behind authentication can be read.
- No changes to deck.gl.
- A new package now, `@developmentseed/range-reader`, since the same reader
  will serve sharded Zarr.
- COG first. Release with COG coalescing, then do Zarr, where the goal is to
  replace zarrita's own range coalescing with this streamed reader.

## Goals

- Fewer requests and less total time for the same view, measured on the
  examples and on the usgs-topo mosaic app.
- At a minimum: the first tile of a view starts rendering in about the same
  time as today, and the last tile always renders sooner with coalesced
  requests than with standalone ones.
- Over-fetched bytes are reusable: a pan that needs them never refetches them.
- The byte cache is pluggable, so a user can decide where it lives (memory
  today; a disk tier such as OPFS later) without the reader changing.
- The header path keeps its guarantees: lazy offset reads are chunked and
  cached, and one tile's abort never fails another tile's lookup (#690).
- Everything is observable: request counts, bytes requested, bytes received,
  bytes over-fetched and cache hits are readable from the reader, so the
  measurement gate below and future tuning have numbers.

## Non-goals

- Zarr and icechunk adapters. They are designed for here, so the core has the
  hooks they need, but they ship in a later release.
- A disk tier (OPFS, Cache Storage). The default byte cache is in memory;
  the cache is an interface from the start so a disk-backed one can be
  supplied by a user now and shipped by us when the caching work comes.
- Whole-level or whole-row prefetch as a default. Nothing here prevents it;
  it becomes a knob once there are numbers.
- Centre-out ordering of merged requests. deck.gl's existing request priority
  stays; order within one stream is file order.
- Any change to deck.gl, including `getMultiTiles` (#273).
- Any change to zarrita or cogeotiff upstream.

## Anti-goals

Carried from usgs-topo PR #23. Any of these makes the work a failure even if
the request count drops:

- **The map looks different once loaded**, including tiles left blank. A read
  that fails leaves its tile blank, and deck.gl does not retry it while it is
  in view. So one tile's read must never fail because another tile was
  cancelled, and a merged request's failure must fail only the reads it
  carries.
- **More bytes on the wire for the same view, unless they are cached on
  purpose and bounded by the over-fetch cap.**
- **The first tile arrives later than today** by more than the measured
  debounce, or **the last tile arrives later than with standalone requests**.
- **Unbounded memory.** Every cache has a byte budget; in-flight buffers are
  counted.

## Constraints

Verified on 2026-10-26 unless noted.

### The network

- Browsers open at most six HTTP/1.1 connections per origin. S3 does not
  negotiate HTTP/2 with browsers. Our `PerOriginSemaphore` already caps at
  six per origin for this reason
  ([`limiter.ts`](https://github.com/developmentseed/deck.gl-raster/blob/48141bb7b8ced5f871eae1ddf58fa1170068a776/packages/geotiff/src/limiter.ts#L206)).
- `Content-Range` is not a CORS-safelisted response header. S3 does not expose
  it by default, so a ranged response often reveals only `Content-Length`,
  the length of the range, not the file size (#524). The reader must never
  need the file size.
- A server that ignores `Range` answers 200 with the whole object. loaders.gl
  v5 detects and aborts this; zarrita's `FetchStore` silently uses the whole
  body as if it were the range.
- Chromium's HTTP cache stores 206 responses as sparse entries. Concurrent
  range requests to one URL contend for the entry lock, and a request that
  waits more than 25 ms bypasses the cache (crbug 969828). neuroglancer sends
  `cache: "no-store"` on Chrome for this reason. We make the fetch cache mode
  an option and measure before changing the default.

### The files

- COGs written by GDAL put all IFDs and tag arrays at the front of the file,
  then the tiles of each level in row-major order, overviews first. Tiles of
  one level are contiguous, so a viewport's tiles are a few runs of adjacent
  tiles separated by the off-screen tiles of the same rows.
- GeoTIFFs from other writers may put IFDs at the end. "Header" is therefore a
  purpose of a read, not a byte offset.
- GDAL's COG driver also writes a "ghost region" of structural metadata right
  after the file header (`LAYOUT=IFDS_BEFORE_DATA`, `BLOCK_ORDER=ROW_MAJOR`,
  `BLOCK_LEADER=SIZE_AS_UINT4`, `BLOCK_TRAILER=LAST_4_BYTES_REPEATED`,
  `MASK_INTERLEAVED_WITH_IMAGERY`). cogeotiff parses it (`tileLeaderByteSize`
  is the block leader). The reader does not depend on it; nothing in this
  design needs the layout to be known. It is available to later prefetch
  knobs, which can rely on row-major contiguity, and read a tile's size from
  its leader without the byte-count table.
- Offset tables cost about 16 bytes per tile (8-byte BigTIFF offsets plus
  4 to 8-byte byte counts). A usgs-topo sheet has about 5k tiles (80 KB). A
  150 GB COG with 512 px tiles has about 800k tiles (13 MB); with 128 px
  tiles, 13M tiles (200 MB). The whole table of a large COG must not be
  resident.

### The libraries

- cogeotiff (`@cogeotiff/core` 9.5) reads the first 16 KiB at open, follows
  the IFD chain with further 16 KiB reads, and reads `TileOffsets` and
  `TileByteCounts` one 4 to 8-byte entry at a time, the first time each tile
  is asked for. Each parsed entry is kept on the tag forever. Today's
  `SourceChunk` (64 KiB) and `LRUCacheMiddleware` (8 MiB per source) exist
  to turn those entry reads into cached blocks
  ([`fromUrl`](https://github.com/developmentseed/deck.gl-raster/blob/48141bb7b8ced5f871eae1ddf58fa1170068a776/packages/geotiff/src/geotiff.ts#L335)).
- Tile bytes go through a separate uncached `dataSource`, one `fetch` per
  tile ([`getBytes`](https://github.com/developmentseed/deck.gl-raster/blob/48141bb7b8ced5f871eae1ddf58fa1170068a776/packages/geotiff/src/fetch.ts#L611)).
  Only `MultiCOGSource` secondaries batch, through
  [`coalesce.ts`](https://github.com/developmentseed/deck.gl-raster/blob/48141bb7b8ced5f871eae1ddf58fa1170068a776/packages/geotiff/src/coalesce.ts)
  (1 MiB gap, 16 MiB max, six in parallel, buffered).
- `getTileByteRange` deliberately leaves the caller's signal out of the shared
  header read and only ends that caller's wait (#690)
  ([`fetch.ts`](https://github.com/developmentseed/deck.gl-raster/blob/48141bb7b8ced5f871eae1ddf58fa1170068a776/packages/geotiff/src/fetch.ts#L566)).
  That rule generalises: a merged request is aborted only when none of its
  reads is still wanted.
- chunkd's `SourceHttp.fetch` and loaders.gl v5's `RangeRequestScheduler`
  both buffer with `response.arrayBuffer()`. Nothing we depend on streams, so
  the reader owns its `fetch` call and the body reader.
- chunkd's `SourceView` sends every middleware request with the entering
  call's signal, so a batcher cannot be middleware. It replaces the source.
- deck.gl 9.4's `Tileset2D` orders tile requests by distance from the
  viewport centre through loaders.gl's `RequestScheduler`, `maxRequests` 6 and
  `debounceTime` 0 by default. It cancels queued tiles that leave the
  selection, and aborts in-flight unselected tiles only while more than
  `maxRequests` loads are in flight (`_pruneRequests`). With a high
  `maxRequests`, every selected tile's `getTileData` runs in one task, which
  is what lets a task-window batcher see the whole selection.
- zarrita 0.7.5 ships `withRangeCoalescing` (microtask window, 32 KiB gap, no
  cap, no cache, no streaming, merges member signals with `AbortSignal.any`)
  and `withByteCaching` (exact-key cache). Its `FetchStore` takes a custom
  `fetch(request)`. icechunk-js 0.6 takes a `fetchClient.fetch(url, init)` for
  virtual chunks and accepts zarrita's coalescer function. Those are the hooks
  the later Zarr adapter will use; they shape nothing in this release beyond
  the core's not-found outcome, suffix reads and whole-object reads.

### The project

- Pre-1.0: breaking option changes are allowed when documented in the
  changelog. Keep the diff small where an option can simply move.
- `GeoTIFF.fromUrl` does not create shared state on its own; the deck.gl
  layers own the shared defaults
  ([`default-concurrency-limiter.ts`](https://github.com/developmentseed/deck.gl-raster/blob/48141bb7b8ced5f871eae1ddf58fa1170068a776/packages/deck.gl-geotiff/src/default-concurrency-limiter.ts#L11)).
  The reader follows the same split.
- Tests mock HTTP by replacing a `fetch` function (today `SourceHttp.fetch`),
  not with a server. Node 24 has `fetch`, `Response` and `ReadableStream`.
- Performance is a top priority of this library. Nothing becomes the default
  without the measurement gate below.

## Design

### Overview

```
COGLayer / MultiCOGLayer / MosaicLayer        (deck.gl-geotiff)
  |  getTileData(tile, { signal })             one call per selected tile, one task
  v
GeoTIFF.fetchTile / fetchTiles                 (geotiff)
  |  headerSource.fetch(...)  purpose "header"  offset-table entries, IFDs
  |  dataSource.fetch(...)    purpose "data"    tile bytes
  v
RangeReader                                    (range-reader)
  |  1. serve from cache, or attach to an in-flight stream, or queue
  |  2. at the end of the task: merge queued reads per file into few ranges
  |  3. per merged range: take a limiter slot, fetch with Range, stream the
  |     body, resolve each read as its last byte lands, cancel when nothing
  |     ahead is wanted, put every received span into the cache
  v
fetch(url, { headers: { Range }, signal, ...init })
```

`RangeReader` is format-agnostic: a URL, a byte range, a signal, a priority
and a purpose. The geotiff package adapts it to the chunkd `Source` shape that
cogeotiff reads through. The later Zarr work adapts it to a `fetch`-shaped
function for zarrita and icechunk.

### The package: `@developmentseed/range-reader`

A new workspace package at `packages/range-reader`, scaffolded like
`packages/affine` (ESM, `tsc --build`, vitest, added to the root `tsconfig.json`
references and to the docs site's API list). No runtime dependencies. The
per-origin limiter moves here from `packages/geotiff`
(`PerOriginSemaphore`, `ConcurrencyLimiter`, `Priority`, `Semaphore`), and the
geotiff package re-exports the same names so its public API does not change.

#### API sketch

Names are the builder's to settle; the shape is the design.

```ts
interface RangeReaderOptions {
  /** Transport. Defaults to `globalThis.fetch`. Tests and custom auth replace it. */
  fetch?: typeof fetch;
  /** Byte budgets of the default in-memory cache, by purpose, or a
   *  user-supplied `ByteCache` (see "Cache"). */
  cache?: { headerBytes?: number; dataBytes?: number } | ByteCache;
  /** Merge rule knobs; see "Merging". */
  maxGap?: number | "median";
  maxOverfetchBytes?: number;
  maxRequestBytes?: number;
  /** Header-purpose reads smaller than this are widened to an aligned block. */
  minHeaderReadBytes?: number;
  /** `RequestInit.cache` for range requests. Default: the browser default. */
  cacheMode?: RequestCache;
}

type ReadRange =
  | { offset: number; length: number }
  | { suffixLength: number }
  | undefined; // the whole object

type ReadResult =
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "not-found" };

interface ReadOptions {
  signal?: AbortSignal;
  purpose: "header" | "data";
  /** Re-evaluated by the limiter on every slot-open; lower is sooner. */
  getPriority?: () => Priority;
  limiter?: ConcurrencyLimiter | null;
  /** Headers, credentials, mode. Part of the merge and cache identity. */
  init?: RequestInit;
}

class RangeReader {
  constructor(options?: RangeReaderOptions);
  read(url: URL, range: ReadRange, options: ReadOptions): Promise<ReadResult>;
  /** Counters for measurement; see "Stats". */
  readonly stats: RangeReaderStats;
}
```

The limiter stays per file handle rather than per reader, because that is
where it lives today (`fromUrl` and `COGSource.open` take it, the layers share
`DEFAULT_CONCURRENCY_LIMITER`) and nothing in this design needs it elsewhere.
A merged request takes one slot of the limiter its reads carry; reads of one
file always carry the same one.

#### Reads and the window

A `read` call first checks the cache, then the in-flight streams, then
queues. Queued reads are flushed once per task (`setTimeout(flush, 0)`, as the
usgs-topo prototype does). A task, not a microtask, because a tile's data read
is issued only after its offset lookup resolves, which may itself be a header
read; the task window still catches every data read that follows one cached
offset block.

A read whose signal is already aborted rejects at once. A read that aborts
while queued is removed from the queue before the flush and rejects with the
signal's reason.

Identical reads (same file identity, same range, same purpose) share one
entry; the second caller attaches to the first.

#### Merging and the over-fetch cap

At flush, reads are grouped by file identity (URL plus request-init
signature, see "Request init and isolation") and by purpose, so every span
the cache ends up holding belongs to one budget, and merged by the usgs-topo
rule: sort by offset, then by length descending; a read joins the current
merged range if it is contained in it, or if the gap is at most `maxGap` and
the merged range stays within both caps:

- `maxOverfetchBytes` bounds the bytes of one merged request that no read
  covers. This is Kyle's required cap, the one that keeps a merge from ever
  reaching across most of a level.
- `maxRequestBytes` bounds one merged request's total size, so a large view
  still splits across the six connections rather than serialising on one.

Header-purpose reads smaller than `minHeaderReadBytes` are first widened to
an aligned block of that size (64 KiB, today's `chunkSize`), so cogeotiff's
entry reads become block reads as they do today, and neighbouring entries hit
the cache.

Defaults for the first implementation, all to be replaced by the measurement
gate: `maxGap: "median"` (the batch's median read length, PR #23's measured
default), `maxOverfetchBytes: 1 MiB`, `maxRequestBytes: 16 MiB` (today's
`coalesce.ts` constants for the latter two). The gap decision is per join,
the over-fetch cap is per merged request.

#### Streaming and resolving

Each merged range becomes one `fetch` with a `Range` header, the carried
`init`, the reader's `cacheMode`, and an `AbortController` the reader owns.
The response body is consumed with `getReader()`. Bytes are copied into one
preallocated buffer of the merged range's length as chunks arrive. After each
chunk, every member read whose end is at or before the received position
resolves, in offset order, with a view into that buffer. Adapters decide
whether to copy (the chunkd adapter must, cogeotiff expects an `ArrayBuffer`
at offset zero, which is what today's slicing does too).

When the body ends cleanly before the merged range's end, the range ran past
the end of the object (see "Responses"): the remaining members resolve with
whatever bytes exist in their range, possibly none, and the buffer is trimmed
to what arrived. Header reads do this routinely, since cogeotiff asks for
16 KiB at every IFD offset and the widening makes the last block of every
file short; today chunkd's chunker slices whatever came back and cogeotiff
parses it. The data path keeps its own check: `getBytes` treats fewer bytes
than a tile's byte count as an error, as it does today.

A member read that resolves is done; nothing later can affect it.

#### Cancellation

Each stream keeps its live member reads. A member leaves when its signal
aborts (its promise rejects at once with the signal's reason) or when it
resolves. After any change, the stream is cancelled if no live member remains,
or if the received position is past the end of the furthest live member. A
cancelled stream releases its limiter slot and keeps its received prefix as a
cache span.

Reads that attach to an in-flight stream (see "Cache") count as live members,
so a stream that someone has since attached to is not cancelled under them.

This is the #690 rule applied everywhere: a read's abort ends only that
read's wait; the request runs on for whoever still wants it.

#### Responses

- **206**: stream as above.
- **200 to a ranged request**: the server ignored `Range`. If `Content-Length`
  is present and at most `maxRequestBytes`, consume the whole object, cache
  it as the span `[0, length)`, and serve the members from it. Otherwise
  cancel the body and reject every member with an error that names the URL
  and the status.
- **200 to a whole-object read**: stream, cache as `[0, received)`.
- **404**: resolve every member with the not-found outcome. The chunkd adapter
  turns it into an error; the later Zarr adapter turns it into `undefined`.
- **416** and any other status: reject every member with an error naming the
  URL and status.
- **Body shorter than the merged range**: two cases, told apart by the
  response's own `Content-Length` (CORS-safelisted, so always readable; it is
  the length of the returned range, not of the file, #524). If the body
  delivered the bytes `Content-Length` promised, the range ran past the end of
  the object: the object's size is now known (`offset + received`), it is
  recorded for the file identity, and the remaining members resolve short as
  described under "Streaming and resolving". If the body ended before
  `Content-Length` was satisfied, the transfer was truncated: members already
  resolved stay resolved; the rest reject with a short-read error naming the
  URL, and the received prefix is still cached. Without a `Content-Length`
  (a test stub, chunked encoding) a clean end is treated as end of object.
- **Network error or abort by the reader's own controller**: members that are
  still live reject with that error; members whose signals aborted already
  rejected with their own reason.

The reader never sends HEAD and never needs the object's size. It records the
size when a response reveals it, from `Content-Range` where CORS exposes it
or from a range that ran past the end, and then uses it to convert suffix
reads to absolute ranges, to answer reads that start at or past the end
without a request, and to clamp widened header blocks.

#### Cache

One cache per reader, shared by every file the reader serves, holding
contiguous byte spans keyed by file identity. A span is a completed or
cancelled stream's buffer, or a whole-object body. Lookup is by containment: a
read is a hit if one span contains its range; partial overlaps are misses (no
stitching). A read whose range lies inside an in-flight stream attaches to it
and resolves when the stream passes its end.

Two budgets, one LRU order each: header-purpose spans count against
`headerBytes`, data-purpose spans against `dataBytes`. Tile churn can never
evict a header span, which is the point; within its budget the header side is
still LRU, so a 150 GB COG keeps only the blocks around regions that have been
visited. In-flight buffers count against their budget and are never evicted;
the budget may be overshot by in-flight bytes, as neuroglancer admits
downloads at size zero.

Defaults, to be measured: `headerBytes` 32 MiB (today is 8 MiB per source;
this is shared, and a mosaic of a thousand sheets needs about 80 MB to hold
every header), `dataBytes` 64 MiB. Both are constructor options and both are
documented as the knobs to raise for large mosaics or scrubbing.

Eviction is by whole span. A span is kept alive by any outstanding view into
it (adapters that hand out views, not copies, keep the span's memory alive
past eviction until the view is dropped; the chunkd adapter copies, so this
is a Zarr-stage concern and is noted there).

The cache is an interface, and the two-budget in-memory cache above is its
default implementation:

```ts
interface ByteCache {
  /** The bytes of `range` if one stored span contains it, else undefined. */
  get(file: FileIdentity, range: ByteRange, purpose: Purpose): Promise<Uint8Array | undefined>;
  /** Store a completed or cancelled span. The cache decides what to keep. */
  put(file: FileIdentity, offset: number, bytes: Uint8Array, purpose: Purpose): Promise<void>;
}
```

Both methods are asynchronous so a disk-backed cache (OPFS, Cache Storage)
can implement it without the reader changing; the in-memory default resolves
synchronously-settled promises. In-flight streams, attaching, and the
not-found outcome stay in the reader, not the cache: a cache only ever holds
bytes. `purpose` is passed so a user-supplied cache can apply its own policy
per purpose, as the default does with its two budgets.

#### Limiter and priority

A merged request takes one slot of its reads' limiter before it fetches,
with a `getPriority` that returns the best (lowest) priority among its live
members, re-evaluated on each slot-open as the limiter already does. Cache
hits and in-flight attaches never take a slot. The slot is released when the
stream ends or is cancelled.

#### Stats

`reader.stats` exposes monotonic counters: requests issued, requests
cancelled early, bytes requested, bytes received, bytes over-fetched (requested
minus covered by reads), reads served from cache and bytes thereof, reads
attached to in-flight streams, and the current cache size per purpose. The
measurement gate reads them from the page; nothing else depends on them.

#### Request init and isolation

`ReadOptions.init` carries headers, credentials and mode for data behind
authentication. The file identity used for merging and caching is the URL
plus a canonical signature of `init` (sorted header names and values,
`credentials`, `mode`), so two layers reading one URL with different
credentials never share a merged request or a cache span, and two with the
same credentials do. The signature is computed once per file handle, not per
read.

#### Suffix reads and whole-object reads

Neither is issued by the COG path. Both are in the core because the Zarr
adapter needs them and they cost little: a suffix read (`{ suffixLength }`)
is sent as `bytes=-N` on its own, never merged, and cached only when the
response's `Content-Range`, or a size learned earlier, places it at an
absolute offset (the cache is keyed by offset, so a suffix of an object of
unknown size has no place in it; when the size is known the read is sent as
an absolute range in the first place). A whole-object read (`range` undefined) is sent without
`Range`, never merged, and cached as `[0, received)` so later ranged reads of
the same object hit it.

### `@developmentseed/geotiff` on the reader

- A chunkd `Source` adapter in the geotiff package (it knows chunkd; the
  reader does not): `type`, `url`, `metadata` (seeded with
  `size: Infinity` as today for #524), `head()` (rejects; never used), and
  `fetch(offset, length, { signal })` that calls `reader.read` with the
  handle's purpose, limiter, priority and init, copies the result into an
  `ArrayBuffer`, and throws on not-found. Negative offsets map to suffix
  reads; a missing length maps to a whole-object read, matching chunkd's
  contract even though cogeotiff never uses either.
- `GeoTIFF.fromUrl(url, options)` builds two adapters over one reader, purpose
  `header` for cogeotiff's `Tiff` and purpose `data` for tile bytes, and
  passes them to `GeoTIFF.open` as `headerSource` and `dataSource` exactly as
  today. New options: `reader?: RangeReader` (when omitted, `fromUrl` creates
  a private reader with default options, so a bare `fromUrl` still batches
  and caches within that file) and `requestInit?: RequestInit`.
  `concurrencyLimiter` and `getPriority` stay as they are. `chunkSize` and
  `cacheSize` are removed; they are reader options now
  (`minHeaderReadBytes`, `cache.headerBytes`), and the changelog says so.
- Removed from the geotiff package: `SourceChunk` and `LRUCacheMiddleware`
  usage, `LimiterMiddleware`, `cache.ts`, `coalesce.ts` and the
  `@chunkd/middleware` dependency. `@chunkd/source-http` is no longer used by
  `fromUrl`; it stays only if something else imports it.
- `getMultipleBytes` issues one `dataSource.fetch` per range and lets the
  reader merge, instead of merging first with `coalesceRanges`. Double
  merging would apply the old 1 MiB gap underneath the new cap. This changes
  `MultiCOGSource` secondaries' request pattern and is covered by the
  measurement gate (sentinel-2).
- `getTileByteRange` keeps its signal rule unchanged. The reader now gives the
  same guarantee one level down, but the function's contract stands on its
  own.
- Tests that stub `SourceHttp.fetch` (`fromurl.test.ts`,
  `shared-header-reads.test.ts`, `geotiff-concurrency-limiter.test.ts`) pass a
  `fetch` to the reader instead. The browser-like S3 stub (no `Content-Range`)
  keeps testing #524.

### deck.gl-geotiff and deck.gl-raster

- `DEFAULT_RANGE_READER`, a module-level shared reader next to
  `DEFAULT_CONCURRENCY_LIMITER`, so every COG layer in a page shares one byte
  cache and one batching window. `COGSource.open`, `MultiCOGSource.open` and
  `MosaicLayer`'s `getSource` take `reader` and `requestInit` options and
  default to it; the layers expose them as props, like `concurrencyLimiter`.
- `COGLayer` and `MultiCOGLayer` set `maxRequests: 256` and
  `debounceTime: 50` in their default props, the prototype's values, so a
  whole selection reaches the reader in one task and a pan settles before
  requests are issued. Both remain user props. `MosaicLayer`'s own tile layer
  is not changed: its `maxRequests` caps concurrent source opens and stays at
  deck.gl's 6, so opens of sheets that leave the view are still dropped, and
  it does not expose `debounceTime` because a debounce on its flat tile model
  keeps sources from ever loading
  ([#562](https://github.com/developmentseed/deck.gl-raster/issues/562)).
  The `COGLayer`s it renders inherit `COGLayer`'s new defaults, which is how
  the prototype set it up. `RasterTileLayer`'s own defaults stay deck.gl's,
  so `ZarrLayer` is untouched until its adapter lands.
- `RasterTileset2D` gains an abort rule: a tile's load is aborted when the
  tile leaves the selection and is not visible, and when a loading tile is
  unloaded. deck.gl does the first only while more than `maxRequests` loads
  are in flight, which a high `maxRequests` disables; without the rule a
  stream would run on for tiles nobody wants, which is exactly the
  prototype's fast-pan cost. The rule is an internal tileset option, not a
  public prop, turned on by the COG-backed layers and left off by
  `ZarrLayer` for this release: a Zarr store wrapped in zarrita's
  `withRangeCoalescing` fails every read of a merged request when one of
  them aborts, so aborting more often there would blank selected tiles (the
  likely cause of [#526](https://github.com/developmentseed/deck.gl-raster/issues/526)).
  The Zarr release replaces that coalescer, turns the rule on for every
  layer and removes the option. `MosaicLayer`'s own tileset schedules source
  opens, not tile reads, and is outside this rule.
- No change to deck.gl's request priority. With `maxRequests` high the
  scheduler's order no longer affects which bytes arrive first; its remaining
  job, cancelling queued tiles that left the selection, still works.

### What this does not change

- Tile decoding, the decoder pool, textures, rendering.
- `GeoTIFF.open`, `fromArrayBuffer`, `fromTiff`: they take sources and do not
  know about the reader.
- The public names of the limiter types.

## Measurement gate

Coalescing becomes the default only after these numbers are in, using the
harness in `dev-docs/perf-harness` (see "How to re-run" in
`dev-docs/perf-research-2026-10.md`) and `reader.stats` read from the page.
Each scenario runs before and after, three repeats, same network.

| Example | Layer | What it exercises |
|---|---|---|
| `cog-basic` | COGLayer | 512 px tiles, the common case |
| `usgs-topo` (in-repo) | COGLayer | one 128 px sheet; header and tile runs |
| kylebarron/usgs-topo app, linked to the local build | MosaicLayer | thousands of 128 px sheets; the 226-request baseline |
| `naip-mosaic` | MosaicLayer | many files per view, shared cache |
| `sentinel-2` | MultiCOGLayer | secondaries through `getMultipleBytes` |
| `vermont-cog-comparison` | COGLayer | multi-hundred-GB files; header budget |

Per scenario: requests, bytes requested, bytes received, bytes over-fetched,
time to first tile, time to the tile under the viewport centre, time to all
tiles, bytes on ten fast pans, and a pixel comparison of the settled
screenshot against the baseline. Then the knob sweeps that set the defaults:
`maxGap` in {8 bytes, 16 KiB, 64 KiB, median}, `maxOverfetchBytes` in
{256 KiB, 1 MiB, 4 MiB}, `debounceTime` in {0, 20, 50}, `cacheMode` in
{default, `no-store`}.

Pass criteria: no scenario regresses on any time metric by more than the
debounce; bytes for the same view do not grow beyond the over-fetch cap;
screenshots are identical; the fast-pan bytes do not exceed the prototype's
with cancellation off.

## Testing

- `range-reader` unit tests with a fake `fetch` whose `Response` bodies are
  `ReadableStream`s the test drives chunk by chunk, and fake timers for the
  window: reads resolve in offset order as bytes land; a read resolves before
  the stream ends; abort of one member never rejects another; a stream is
  cancelled when its last live member leaves, and when the position passes
  the furthest live member, and its prefix is cached; a read inside an
  in-flight stream attaches; cache hits by containment, misses on partial
  overlap; the two budgets evict independently and header spans survive data
  churn; merge rule and both caps; header read widening; 200, 404, 416; a
  range past the end of the object resolves its members short and records
  the size, a truncated body rejects the unresolved members; a file smaller
  than one widened block opens; limiter slot per merged request with
  best-member priority; identical reads share; init signature partitions
  merging and caching; suffix and whole-object reads; `stats` counters.
- Mutation checks on the cancellation rules, as this repo does for
  correctness-critical paths: flip each cancel condition and confirm a test
  fails.
- geotiff: existing `fromurl`, `shared-header-reads`, limiter and
  `get-multiple-bytes` tests ported to the reader's `fetch` option; the
  integration tests stay pixel-identical on the fixtures.
- deck.gl-raster: a tileset test that, with the abort option on, a loading
  tile is aborted when it leaves the selection and when it is unloaded, and
  that with it off deck.gl's behaviour is unchanged.
- The measurement gate above is not a test and is not automated.

## Stages

One PR each, reviewed in order; the first can merge and publish unused.

1. **`packages/range-reader`**: the core, the cache, the stats, the limiter
   moved in, tests. Docs page on the site.
2. **`packages/geotiff` on the reader**: the chunkd adapter, `fromUrl`
   options, the removals, `getMultipleBytes` simplification, test ports.
   Behaviour of a bare `fromUrl` is batching within one file.
3. **deck.gl-geotiff and deck.gl-raster**: `DEFAULT_RANGE_READER`, the
   options and props, `COGLayer` and `MultiCOGLayer` default props, the
   tileset abort option (on for the COG-backed layers), and the
   measurement gate's results in the PR description with the defaults set
   from them.

Then a release with COG coalescing. Zarr starts after it.

## Afterwards

- **Zarr** (next release): a `fetch`-shaped adapter in `range-reader`
  (`fetch(input, init)` that parses `Range`, routes through the reader, and
  returns a synthetic 206, 200 or 404 `Response`, answering HEAD from the
  recorded size or by passing through) for zarrita's `FetchStore({ fetch })`
  and icechunk's `fetchClient`; a store extension for stores that are not
  `FetchStore`; `ZarrLayer` defaults; `useSuffixRequest` guidance. The aim is
  to replace zarrita's buffered coalescer with streams, and to fix its merged
  abort at the same time. That release also turns the tileset abort rule on
  for every layer and removes the option.
- **Prefetch knobs**: a larger first read at open (header plus coarse
  overviews in one stream, cancelled once the wanted tiles have passed) and
  whole-row or whole-level prefetch for small files, once the gate has
  numbers for the over-fetch cap. GDAL's ghost region can back both: its
  row-major guarantee makes a row a single range, and the block leader gives
  a tile's size without the byte-count table.
- **Disk tier** and the chunk manager
  (`dev-docs/chunk-manager-prior-art-2026-10.md`): a `ByteCache` backed by
  OPFS or Cache Storage stores the same spans on disk, so range fetches
  survive a reload and a scrub back in time; the in-memory cache becomes the
  tier above it.

## Left to the builder

- Names and file layout inside `range-reader`; whether the window is one
  `setTimeout` per reader or per file.
- The merge implementation (the usgs-topo `mergeReads` is the reference).
- How `stats` is structured and how the harness reads it from the page.
- The exact `RasterTileset2D` hook for the abort rule (`updateTileStates`
  after `super`, or a `_pruneRequests` override).
- Changelog entries and the docs page.
