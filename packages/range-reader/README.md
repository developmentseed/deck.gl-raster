# @developmentseed/range-reader

Streamed, coalesced HTTP byte-range reads with a budgeted byte cache.

A client that knows a file's layout, such as a Cloud-Optimized GeoTIFF reader
with its tile offset table in hand, wants many small byte ranges at once.
This package merges the reads issued in one task into few range requests,
reads each response body as a stream and resolves every read the moment its
last byte arrives, cancels a request as soon as nobody wants what is left of
it, and keeps every received span in a byte cache with separate budgets for
header and data bytes, so a later read inside an earlier request is served
from memory.

Status: stage 1, no consumers yet. See
`dev-docs/specs/2026-10-26-range-reader-design.md` in the repository.
