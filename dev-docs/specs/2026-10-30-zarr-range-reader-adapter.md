# Zarr on the Range Reader

- **Date:** 2026-10-30
- **Issues:** [#690](https://github.com/developmentseed/deck.gl-raster/issues/690) (one tile's abort must never fail another), [#526](https://github.com/developmentseed/deck.gl-raster/issues/526) (AbortErrors blanking Zarr tiles), [#762](https://github.com/developmentseed/deck.gl-raster/issues/762) (re-fetch of bytes already downloaded), [#577](https://github.com/developmentseed/deck.gl-raster/pull/577) (icechunk-js integration)
- **Status:** Draft for review; follows the COG release of the range reader ([#806](https://github.com/developmentseed/deck.gl-raster/pull/806), [#815](https://github.com/developmentseed/deck.gl-raster/pull/815), [#807](https://github.com/developmentseed/deck.gl-raster/pull/807), [#809](https://github.com/developmentseed/deck.gl-raster/pull/809)); extends the [range reader design](./2026-10-26-range-reader-design.md), whose "Afterwards" section sketched this

Code links are pinned to main at
[`2f2dcc87`](https://github.com/developmentseed/deck.gl-raster/commit/2f2dcc87dbcfbd8455403601e6fea33267c24f7e).

## Problem

Zarr reads do not go through the range reader. `ZarrLayer` draws whatever
zarrita store the app builds, almost always a `zarr.FetchStore`, and a
sharded array reads through zarrita's sharding codec: one suffix read for the
shard index, then one `getRange` per inner chunk. For the ECMWF example that
is 100 inner-chunk reads per 320 px tile, each its own HTTP request unless the
app wraps the store in zarrita's `withRangeCoalescing`.

That wrapper is what the COG work replaced, and it has the problems the COG
work fixed:

- It batches per microtask with a fixed 32 KiB gap and no cap on a merged
  request, buffers the whole merged response before slicing, and holds no
  cache; `withByteCaching` is an exact-key map on top.
- It merges every member's abort signal with `AbortSignal.any`, so one tile
  leaving the view fails every read in its group. That is the
  [#690](https://github.com/developmentseed/deck.gl-raster/issues/690) class,
  and the likely cause of
  [#526](https://github.com/developmentseed/deck.gl-raster/issues/526).
- Because of that, `ZarrLayer` keeps deck.gl's six-at-a-time request
  throttle and deck.gl's abort rule, so even a coalesced store sees at most
  six tiles' reads per batch and runs streams on for tiles nobody wants.
- Its bytes share nothing with the page's COG layers: no common cache, no
  common per-origin limiter, no common batching window.

icechunk has the same shape: `IcechunkStore` reads virtual chunks through a
pluggable `fetchClient` and accepts zarrita's coalescer as an option.

## Decided

Decisions taken in review of the COG release, carried here:

- **Behaviour changes only for sources the library opens itself.** When
  `ZarrSource.open` is given a URL it builds the store over the shared reader,
  and the layer then releases whole selections and aborts tiles that leave
  the view, as `COGLayer` does. An app-supplied store keeps today's
  behaviour: a store wrapped in zarrita's coalescer would still fail merged
  groups on abort, so the library never turns the abort rule on for it. The
  COG spec planned to turn the rule on for every layer and drop the tileset
  option; the option stays.
- **The shared default reader moves down to `range-reader`**, created
  lazily, so COG and Zarr sources share one cache and one batching window
  without `deck.gl-raster` taking a dependency it has no other use for.
  `GeoTIFF.fromUrl`'s private fallback reader is unchanged.
- **The ECMWF example is the sharded benchmark.** Its store is consolidated
  and every variable is sharded: shards of `[1, 85, 51, 320, 320]` with inner
  chunks of `[1, 85, 51, 32, 32]` float32, zstd. A tile is one shard and
  100 inner chunks. The inner chunks are large and decode-heavy, so the
  request and byte counts are the signal there, not wall time.

## Goals

- Every read of a `ZarrSource` opened from a URL goes through a
  `RangeReader`: streamed, merged per task within the caps, cached under the
  page-wide budgets, limited per origin, and cancelled per read.
- One tile's abort never fails another's read. A stream runs on while any
  live read wants what is left and stops when none does.
- A sharded tile's inner-chunk reads merge into few requests, and a pan away
  and back refetches nothing within the cache budget.
- icechunk's virtual-chunk reads go through the same adapter with no code in
  `deck.gl-zarr` specific to icechunk.
- An app that builds its own `FetchStore` can put it on the reader with one
  option, and an app that needs auth passes `requestInit` as it does for
  COGs.

## Non-goals

- Changing how `deck.gl-zarr` decodes or selects data; zarrita's codecs and
  `zarr.get` are untouched.
- Conditional requests (`If-Match`, `If-None-Match`) through the reader.
  icechunk's `validateChecksums` sends them; such requests bypass the reader.
- A PMTiles adapter, a disk tier, or the adaptive request cap. Each is its
  own follow-up.
- Any change to zarrita or icechunk-js upstream.

## Constraints

### zarrita 0.7.5 and `@zarrita/storage` 0.2.0

- `FetchStore` takes `fetch?: (request: Request) => Promise<Response>`,
  `overrides?: RequestInit` merged into every request, and
  `useSuffixRequest?: boolean`. Every read, metadata documents included, goes
  through that `fetch` as a `Request`: `get(key)` with no `Range`, an
  absolute `getRange` with `Range: bytes=a-b`, and a suffix `getRange` as
  `Range: bytes=-n` when `useSuffixRequest` is on, else as a `HEAD` followed
  by an absolute range.
- Its response handling is all the adapter must satisfy: status 404 is
  `undefined`, 200 and 206 are the body as bytes, anything else throws.
  `Content-Range` is never read.
- The sharding codec reads the index as a suffix (or, with
  `index_location: "start"`, as an absolute range at offset 0) and then the
  wanted inner chunks with one `getRange` each in the same task, passing the
  caller's `signal` through. `zarr.get` resolves the signal per call.
- `withConsolidatedMetadata(store)` reads `/zarr.json` and throws
  `NotFoundError` when it carries no consolidated metadata; it does not fall
  back.

### icechunk-js

- `IcechunkStore.open(session, { fetchClient })` takes
  `{ fetch(url: string, init?: RequestInit): Promise<Response> }`. icechunk
  builds `Range`, and with `validateChecksums` the `If-Match` or
  `If-Unmodified-Since` header, before calling it.
- Its `withRangeCoalescing` option takes zarrita's coalescer function and is
  the thing this replaces.

### The project

- `ZarrSource.open` takes an opened `zarr.Group` or `zarr.Array`; the app
  builds the store. `ZarrLayer.source` accepts a `ZarrSource` or either node.
- `RasterTileLayer` forwards `maxRequests` and `debounceTime` to its tileset
  and asks `_abortUnwantedLoads()` for the abort rule; `COGLayer` and
  `MultiCOGLayer` set 256, 50 ms and true.
- `DEFAULT_RANGE_READER` and `DEFAULT_CONCURRENCY_LIMITER` are constants in
  `deck.gl-geotiff`. `deck.gl-raster` does not depend on `range-reader`.
- The reader's `read` takes a `FileIdentity` (URL plus request-init
  signature), a `ReadRange` (absolute, suffix, or `undefined` for the whole
  object) and `ReadOptions` (`purpose`, `signal`, `getPriority`, `limiter`),
  and resolves to bytes with the file's validator, or `not-found`.

## Design

### Overview

One `fetch`-shaped function in `range-reader` turns a request into a reader
read and the result back into a `Response`. zarrita's `FetchStore` and
icechunk's `fetchClient` both take such a function, so neither needs a store
class of its own. `deck.gl-zarr` adds the Zarr-specific pieces around it: a
purpose classifier, a URL form of `ZarrSource.open`, a helper for apps that
build their own store, and the `ZarrLayer` behaviour for reader-backed
sources. The examples switch to the URL form.

### `rangeReaderFetch` in `range-reader`

```ts
export interface RangeReaderFetchOptions {
  /** Classifies a read; default: suffix reads are metadata, the rest data. */
  purpose?: (url: URL, range: ReadRange | undefined) => Purpose;
  limiter?: ConcurrencyLimiter | null;
  getPriority?: () => Priority;
}

export function rangeReaderFetch(
  reader: RangeReader,
  options?: RangeReaderFetchOptions,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
```

The returned function accepts both call forms: a `Request` (zarrita) and
`(url, init)` (icechunk). It normalizes to a URL, a method, headers and a
signal, then:

| Request | Reader call | Response |
|---|---|---|
| `GET`, `Range: bytes=a-b` | `read(file, { offset: a, length: b - a + 1 })` | 206, the bytes, `Content-Range: bytes a-b/*` |
| `GET`, `Range: bytes=-n` | `read(file, { suffixLength: n })` | 206, the bytes |
| `GET`, no `Range` | `read(file, undefined)` | 200, the bytes |
| any of the above, `not-found` | | 404, empty body |
| `HEAD`; any other method; `Range` in another form (`bytes=a-`, several parts); `If-Match`, `If-None-Match`, `If-Modified-Since` or `If-Unmodified-Since` present | passed through to the reader's own `fetch`, unchanged | that response |

Every synthetic response carries `ETag` when the read's result has a
validator, so a consumer that checks validators (icechunk, later pmtiles)
sees the one the reader saw. `Content-Length` is set from the bytes.

**File identity** is `fileIdentity(url, init)` where `init` is the request's
headers without `Range`, plus `credentials` and `mode` (the fields
`initSignature` covers; the builder checks that list). The same `init` is
what the reader's streams send, so an `Authorization` header set through
`FetchStore`'s `overrides` or icechunk's client reaches the network. A
`Request` input is reduced to that `init`; its own `signal` becomes the
read's signal.

**Abort** follows `fetch`: an aborted signal rejects the returned promise
with the signal's reason. The reader rejects only that read and ends the
stream only when no live read wants its remaining bytes, which is the
[#690](https://github.com/developmentseed/deck.gl-raster/issues/690) fix
applied to Zarr.

**Errors**: a read that rejects (network failure, an HTTP error from the
stream) rejects the returned promise. zarrita throws on any status it does
not expect, so a rejection and an error `Response` are the same to it;
rejecting keeps the real error.

**Purpose** has no Zarr knowledge here. The default calls suffix reads
metadata, which covers a shard index at the end of its file, and everything
else data. A whole-object `get` is data by default because an unsharded
chunk is a whole-object read; the Zarr classifier below corrects the metadata
documents.

### `defaultRangeReader()` and `defaultConcurrencyLimiter()`

Two lazily created singletons in `range-reader`, one `RangeReader` with the
default budgets and one `PerOriginSemaphore` with six slots per origin, so
every source on the page that opens from a URL shares them unless given its
own. `deck.gl-geotiff` keeps `DEFAULT_RANGE_READER` and
`DEFAULT_CONCURRENCY_LIMITER` as the same objects, so nothing breaks, and
`deck.gl-zarr` uses the functions directly.

### `deck.gl-zarr`

**`zarrPurpose(url, range)`**: `metadata` for a suffix read, and for a key
ending in `zarr.json`, `.zarray`, `.zgroup`, `.zattrs` or `.zmetadata`;
`data` otherwise. Consolidated metadata is one `zarr.json`, cached once under
the metadata budget; a shard index read at `index_location: "start"` cannot
be told from a chunk read by URL and counts as data.

**`createFetchStore(url, { reader, requestInit })`**: a `zarr.FetchStore`
over `rangeReaderFetch(reader, { purpose: zarrPurpose, limiter })`, with
`useSuffixRequest: true` and `overrides: requestInit`. Exported for apps that
open the hierarchy themselves (a group with a variable to choose, an array
with its own GeoZarr metadata, a wrapper to apply), as the ECMWF example
does. `useSuffixRequest` is on because the reader resolves a suffix in one
request; `FetchStore`'s default of a `HEAD` first would double every shard
index read.

**`ZarrSource.open(input, options)`** accepts a `string` or `URL` as well
as a node. For a URL it builds the store with `createFetchStore`, tries
`withConsolidatedMetadata` and on `NotFoundError` keeps the plain store (the
`/zarr.json` it read is cached, so the fallback costs no request), opens the
root node with `zarr.open`, and continues as today. Two options join
`ZarrSourceOptions`, named as in `COGSourceOptions`: `reader`, default
`defaultRangeReader()`, and `requestInit`; both are ignored for a node input,
as `COGSource` ignores them for an opened `GeoTIFF`. The source records the
reader it opened with as `source.reader`, `undefined` for a node input; that
is what the layer reads.

**`ZarrLayer`**: `source` accepts `string | URL`, passed to
`ZarrSource.open` through `_openSource`. When `source.reader` is set, the
layer behaves as `COGLayer`: `_abortUnwantedLoads()` is true, and
`maxRequests` and `debounceTime` left at deck.gl's defaults become 256 and
50 ms. With an app-built store nothing changes. The base layer forwards the
two props to the tileset in one place; a protected hook there, next to
`_abortUnwantedLoads`, is the natural seam, and the plan picks its name.

**Removed**: nothing public. The examples stop using `withRangeCoalescing`
and `withConsolidatedMetadata` directly, and the README's guidance on
zarrita's coalescer points at the URL form and `createFetchStore` instead.

### icechunk

`IcechunkStore.open(session, { fetchClient: { fetch: rangeReaderFetch(reader) } })`
is the whole integration, using the `(url, init)` form. icechunk's virtual
chunk reads are absolute ranges into NetCDF or other files and merge like
tiles when a selection touches neighbours. Its `withRangeCoalescing` option
is not passed. A session with `validateChecksums` sends conditional headers,
which the adapter passes through; that is correct and documented, not
optimized. The nldas-icechunk example gains the client and nothing else;
`ZarrSource.open` with a node is unchanged, so this example's layer keeps
deck.gl's defaults, as decided.

### What this does not change

- A `ZarrSource` opened from a node: same reads, same abort behaviour, same
  defaults as today.
- `zarr.get`, the codecs, the tile grid, the selection logic.
- The reader's merge rule, caps and budgets. Zarr bytes share the data budget
  with COG tiles; the ECMWF inner chunks are large enough that the 64 MiB
  default holds few of them, which is the existing adaptive-budget question,
  not a new one.
- `GeoTIFF.fromUrl`'s private fallback reader.

## Measurement gate

The COG benchmark harness, with its request and byte counts per scenario, on:

| Example | Store | What it tests |
|---|---|---|
| `dynamical-zarr-ecmwf` | sharded, consolidated, remote | inner-chunk merging within a shard; the abort fix under a fast pan |
| `zarr-sentinel2-tci` | unsharded, local server | whole-object chunk reads: no merging, so no regression allowed |
| `nldas-icechunk` | icechunk virtual chunks | the `(url, init)` form; merging of neighbouring virtual chunks |

Scenarios: load, pan, pan back, fast pan, zoom. Before is the example as it
is on main; after is the example on the URL form.

Pass:

- ECMWF: requests per tile fall from one per inner chunk read to the merged
  count; all-loaded time is not worse than before (decode dominates, so
  parity is the bar); the pan-back scenario refetches nothing that fits the
  budget; a fast pan produces no blank selected tile and no unhandled
  `AbortError` (the [#526](https://github.com/developmentseed/deck.gl-raster/issues/526) check).
- sentinel2 and nldas: request count and time within noise of before.
- Results tables in the PR bold the decisive cells.

## Testing

`range-reader`, unit, with a fake `fetch` that serves a byte array with
`Range` support:

- each row of the request table above, in both call forms;
- identity: two requests differing only in `Range` share a file, two
  differing in `Authorization` do not, and the stream's request carries the
  header;
- abort: aborting one of two concurrent reads of one file rejects that one
  with the signal's reason and resolves the other;
- `ETag` and `Content-Length` on synthetic responses; 404 on `not-found`;
  pass-through for `HEAD`, conditional headers and unsupported `Range` forms;
- the default purpose and the `limiter` and `getPriority` options reaching
  the reader.

`deck.gl-zarr`, with zarrita over an in-memory v3 store served through the
same fake `fetch`:

- `ZarrSource.open(url)` reads an unsharded array and a sharded one
  (`index_location` end and start) to the same values as a direct zarrita
  read, with the sharded tile's reads merged into one request per shard;
- consolidated metadata used when present and the fallback when not, with no
  extra request;
- `zarrPurpose` on each key kind; `reader` and `requestInit` honoured for a
  URL and ignored for a node;
- `ZarrLayer`: abort rule and the two defaults on for a reader-backed
  source, off for a node; an explicit `maxRequests` wins either way.
- The sharded store fixture is written by zarrita if its sharding codec
  encodes, else generated once by the pixi environment into `fixtures/`.

The icechunk form is covered by the adapter's `(url, init)` tests and the
example; icechunk-js is not a test dependency.

## Stages

Two PRs, stacked:

1. **`range-reader`: `rangeReaderFetch`, `defaultRangeReader`,
   `defaultConcurrencyLimiter`**, with the unit tests; `deck.gl-geotiff`'s two
   constants become the shared objects. No behaviour change for COGs.
2. **`deck.gl-zarr` on the reader**: `zarrPurpose`, `createFetchStore`, the
   URL form of `ZarrSource.open`, `ZarrLayer`'s reader-backed behaviour, the
   icechunk client in the nldas example, the three examples on the URL form,
   README and docs, and the benchmark in the PR body.

Then the release that was planned to follow the COG one carries both.

## Left to the builder

- The exact `init` fields `initSignature` hashes, and so which a `Request`
  input must be reduced to.
- Whether `Content-Range` on a suffix read's 206 can be filled from the size
  the reader learned; omitted when not, since no consumer reads it.
- The name and shape of the base-layer hook for the two request defaults.
- Whether zarrita 0.7.5 encodes sharded arrays, which decides where the test
  fixture comes from.
