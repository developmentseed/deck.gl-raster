# @developmentseed/range-reader

Streamed, coalesced HTTP byte-range reads with a budgeted byte cache.

A client that knows a file's layout, such as a Cloud-Optimized GeoTIFF reader
with its tile offset table in hand or a sharded Zarr reader with a shard index
in hand, wants many small byte ranges at once. This package merges the reads
issued in one task into few range requests, reads each response body as a
stream and resolves every read the moment its last byte arrives. It also
cancels a request as soon as nobody wants what is left of it. Everything
received, including the bytes between the reads a request was merged across,
lands in a byte cache with separate budgets for metadata and data bytes, so a
later read inside an earlier request is served from memory.

Why merge at all: a browser opens at most six HTTP/1.1 connections per host,
and the big object stores (S3, Azure Blob) speak only HTTP/1.1, so a viewport
of a hundred tiles fetched one request each waits in a queue six at a time.
One request per run of adjacent tiles empties that queue, and it also pays the
store's per-request latency and per-request price once per run instead of
once per tile. Over HTTP/2 (GCS, CDN fronts such as CloudFront) the queue is
gone, but the per-request latency and price remain, and a server sharing one
connection across a hundred streams finishes every tile late rather than in
order.

## Usage

```ts
import {
  fileIdentity,
  PerOriginSemaphore,
  RangeReader,
} from "@developmentseed/range-reader";

const reader = new RangeReader();
// Six matches the browser's HTTP/1.1 connections per host, so requests wait
// here, where priority and cancellation apply, not inside the browser.
const limiter = new PerOriginSemaphore({ maxRequests: 6 });

// One identity per file, built once: the URL plus the request parameters
// (headers, credentials, mode) it is read with.
const file = fileIdentity("https://example.com/scene.tif", {
  headers: { authorization: "Bearer ..." },
});

// Reads issued in the same task are merged into as few range requests as
// the gap and over-fetch limits allow. Each resolves as its bytes arrive.
const [a, b] = await Promise.all([
  reader.read(file, { offset: 1_048_576, length: 65_536 }, { limiter }),
  reader.read(file, { offset: 1_114_112, length: 65_536 }, { limiter }),
]);

if (a.kind === "bytes") {
  console.log(a.bytes.length); // 65536
}
console.log(reader.stats); // requests, bytes, cache hits, ...
```

A read whose `signal` aborts rejects at once with the signal's reason; the
request it was part of runs on while another read still wants it, and is
cancelled, keeping what arrived, when the last one leaves.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `fetch` | `globalThis.fetch` | Transport. Replace it for custom auth or in tests. |
| `cache` | in-memory, 32 MiB metadata + 64 MiB data | Budgets for the default cache, or a `ByteCache` of your own. |
| `maxGap` | `"median"` | Largest gap between two reads that still share a request; `"median"` is the batch's median read length. |
| `maxOverfetchBytes` | 1 MiB | Largest number of bytes in one request that no read covers. |
| `maxRequestBytes` | 16 MiB | Largest merged request; also the largest whole object accepted from a server that ignores `Range`. |
| `minMetadataReadBytes` | 64 KiB | Metadata reads shorter than this are widened to an aligned block of this size, read to its end. |
| `cacheMode` | the browser's default | `RequestInit.cache` for every request. |

A read may name its `purpose`: `"data"`, the default, for payload such as
tiles and chunks, or `"metadata"` for the structural bytes a format reads
before it can ask for data and that every later read depends on: a COG's
IFDs and offset tables, a sharded Zarr shard's index, a PMTiles directory.
Metadata reads are widened to aligned blocks, merged separately, and counted
against their own cache budget, so data churn never evicts them. A read is
served from any cached span that contains it, and attaches to any request in
flight that covers it, whichever purpose fetched it: the first tiles of a COG
often arrive inside its first metadata block.

## Bring your own cache

The byte cache is an interface. The default keeps spans in memory under two
budgets; a disk-backed one (OPFS, Cache Storage) implements the same two
methods, plus the optional `byteSize`:

```ts
interface ByteCache {
  get(file: FileIdentity, range: ByteRange, purpose: Purpose): Promise<Uint8Array | undefined>;
  put(file: FileIdentity, offset: number, bytes: Uint8Array, purpose: Purpose): Promise<void>;
  byteSize?(purpose: Purpose): number;
}
```

`get` answers with the bytes of `range` when one stored span contains all of
it. In-flight requests and the not-found outcome stay in the reader; a cache
only ever holds bytes.

## Status

Stage 1 of the design in `dev-docs/specs/2026-10-26-range-reader-design.md`:
the package has no consumers yet. `@developmentseed/geotiff` adopts it in
stage 2, so every COG layer reads through it.
