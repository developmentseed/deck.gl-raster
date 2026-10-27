# @developmentseed/range-reader

Streamed, coalesced HTTP byte-range reads with a budgeted byte cache.

A client that knows a file's layout, such as a Cloud-Optimized GeoTIFF reader
with its tile offset table in hand, wants many small byte ranges at once.
This package merges the reads issued in one task into few range requests,
reads each response body as a stream and resolves every read the moment its
last byte arrives, and cancels a request as soon as nobody wants what is
left of it. Everything received, including the bytes between the reads a
request was merged across, lands in a byte cache with separate budgets for
metadata and data bytes, so a later read inside an earlier request is served
from memory.

## Usage

```ts
import {
  fileIdentity,
  PerOriginSemaphore,
  RangeReader,
} from "@developmentseed/range-reader";

const reader = new RangeReader();
const limiter = new PerOriginSemaphore({ maxRequests: 6 });

// One identity per file, built once: the URL plus the request parameters
// (headers, credentials, mode) it is read with.
const file = fileIdentity("https://example.com/scene.tif", {
  headers: { authorization: "Bearer ..." },
});

// Reads issued in the same task are merged into as few range requests as
// the gap and over-fetch limits allow. Each resolves as its bytes arrive.
const [a, b] = await Promise.all([
  reader.read(file, { offset: 1_048_576, length: 65_536 }, {
    purpose: "data",
    limiter,
  }),
  reader.read(file, { offset: 1_114_112, length: 65_536 }, {
    purpose: "data",
    limiter,
  }),
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
| `minMetadataReadBytes` | 64 KiB | Metadata-purpose reads shorter than this are widened to an aligned block of this size. |
| `cacheMode` | the browser's default | `RequestInit.cache` for every request. |

Every read names its `purpose`, `"metadata"` or `"data"`. The two are merged
separately and count against separate cache budgets, so data churn never
evicts the small structural reads every later read depends on. A read is
served from any cached span that contains it, whichever purpose fetched it:
the first tiles of a COG often arrive inside its first metadata block.

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
