# COG block-aligned header cache

**Date:** 2026-05-12
**Issue:** [#500](https://github.com/developmentseed/deck.gl-raster/issues/500)
**Status:** Design — supersedes [`2026-05-05-geotiff-readahead-cache-design.md`](2026-05-05-geotiff-readahead-cache-design.md) (and the unmerged PR [#509](https://github.com/developmentseed/deck.gl-raster/pull/509)).

## Background

The original design (the sequential exponential read-ahead cache, then a frozen-after-open variant) tried to optimize *steady-state* tile rendering by bulk-loading `TileOffsets` / `TileByteCounts` arrays for each IFD. That moved the cost to *open time*. On a real 200 GB Vermont COG, that's tens of MB downloaded before any tile renders — even though the initial view is at an overview level whose primary-image arrays are never used.

geotiff.js takes the opposite approach. Each `fromUrl` call requests just 1024 bytes (header + first IFD pointer), but its `BlockedSource` pads this up to one 64 KiB block — so the first underlying HTTP request is a full block, not 1024 bytes. `getImage(i)` reads only that IFD's entries; tile-array values are wrapped in a `DeferredArray` that holds only their file offset + count. When a tile is requested, `DeferredArray.get(index)` fetches the specific 4–8 byte offset entry (and separately the byte-count entry) through the same block-aligned `BlockedSource` — adjacent entries from the same array all live in the same 64 KiB block, so per-tile lookups cost ~0 HTTP requests after the first one in a region. The block cache lives inside the source layer; cogeotiff's lazy per-entry reads benefit from it automatically.

Our implementation uses the same shape: cogeotiff's `image.getTileSize(idx)` reads `TileOffsets[idx]` and `TileByteCounts[idx]` lazily through the wrapped header source, and our chunk cache turns those 4–8 byte reads into shared 64 KiB block fetches. cogeotiff's first byte read uses its default `DefaultReadSize` (16 KiB); `SourceChunk` pads it up to the chunk size, so the actual wire request is one block.

That design lines up with how cogeotiff was built to be used — `image.init(true)` already loads only "important tags" (dimensions, tile size, georeferencing, GeoKeys) and defers everything else.

## Goals

1. **Low first-paint latency on huge COGs.** Opening a 200 GB COG should make ~one HTTP request, not tens of MB worth.
2. **Bounded steady-state cost per tile.** After warmup, per-tile metadata reads should be effectively free (served from block cache).
3. **Bounded memory.** The cache must evict; never grow without bound.
4. **No header / tile cache crossover.** Tile data bytes must not pollute the header cache. Header bytes must not have to share space with tile data.

## Solution

Use chunkd's built-in `SourceChunk` + `SourceCache` middleware with a fixed 64 KiB block size and an LRU-ish cache. Drop all the bespoke read-ahead machinery from the previous design.

```ts
const source = new SourceHttp(url);
source.metadata = { size: Infinity };          // #524 workaround
const view = new SourceView(source, [
  new SourceChunk({ size: 64 * 1024 }),
  new SourceCache({ size: 8 * 1024 * 1024 }),  // ~128 blocks
]);

const tiff = await Tiff.create(view, { signal });
tiff.options = undefined;                       // disable leader-bytes path
```

### Why fixed 64 KiB blocks?

- Matches geotiff.js's default. Proven in practice across the GeoTIFF ecosystem.
- One block holds ~8000 BigTIFF tile-offset entries (8 bytes each) or ~16000 classic-TIFF entries (4 bytes each). A viewport's worth of adjacent tile lookups almost always hits a single cached block.
- No tunable that has to be right per file. Pathological cases (huge metadata regions, far-offset probes) all degrade gracefully — they just cost more block fetches.

### Why LRU eviction?

The previous design's sequential cache *never evicted*. For long-running sessions or large files, that's a memory leak. `SourceCache` is a two-generation cache (cacheA flips to cacheB on overflow, cacheB drops) — not strict LRU but bounded and approximately recency-aware in practice.

### Why disable cogeotiff's leader-bytes path?

cogeotiff auto-detects the GDAL ghost option `BLOCK_LEADER=SIZE_AS_UINT4` at `Tiff.create()` time. If present, `TiffImage.getTileSize()` skips the `TileByteCounts` lookup and instead fetches 4 bytes just before the tile data. The comment in cogeotiff explains the intent: *"This fetch will generally load in the bytes needed for the image too provided the image size is less than the size of a chunk."* But that assumption breaks for tiles larger than the block size (very common — many COG tiles are 256×256×3 bytes ≈ 200 KB, well above 64 KiB). When it breaks, the result is:

1. A 64 KiB chunk fetch near the tile, populated into the header cache, evicting metadata.
2. The actual tile fetch via `dataSource` still has to fetch the whole tile.

So the optimization actively hurts. Setting `tiff.options = undefined` after `Tiff.create()` removes it. `getTileSize` then always takes the explicit `TileOffsets` / `TileByteCounts` path, which goes through cogeotiff's lazy per-entry mechanism — served by our header cache, never touching tile data. cogeotiff core only reads `tiff.options` from this one location, so no other behavior is affected.

### Why separate `dataSource` and `headerSource`?

The split (already present in our `GeoTIFF.fromUrl`) keeps tile data out of the header cache:

- `dataSource` = raw `SourceHttp` — used by [`packages/geotiff/src/fetch.ts`](../../packages/geotiff/src/fetch.ts) for tile data reads via `geotiff.dataSource.fetch(...)`. No caching, no chunking. Each tile is one HTTP range request.
- `headerSource` = the wrapped `SourceView` — passed to `Tiff.create()`. All of cogeotiff's reads (IFD parsing, lazy tag fetches, lazy per-tile offset/bytecount entries) go through this. Block-cached.

### Why drop the eager `TileOffsets`/`TileByteCounts` prefetch?

`prefetchTags` currently bulk-fetches both arrays for the primary image. On a 200 GB COG with millions of tiles, that array alone is ~8 MB. The deferred approach lets cogeotiff lazy-fetch individual entries through the block cache; adjacent entries in a viewport hit one block.

Other tags in `prefetchTags` stay — they're small and needed to decode tiles:

- `SamplesPerPixel`, `BitsPerSample`, `SampleFormat`
- `Photometric`, `Predictor`, `PlanarConfiguration`
- `ColorMap` (for paletted)
- `GdalNoData`, `GdalMetadata`
- `LercParameters` (for LERC compression)

These tag values are typically <10 KB total per IFD. Loading them at open lets us return a fully-formed `GeoTIFF` without per-tile latency for tag lookups.

## What gets removed

Compared to the unmerged PR [#509](https://github.com/developmentseed/deck.gl-raster/pull/509):

- `packages/geotiff/src/source/readahead-cache.ts` (entire file — `SequentialBlockCache`, `SourceReadaheadCache`, `freeze()` lifecycle).
- `packages/geotiff/src/source/concurrency.ts` (`mutex()` helper — no longer needed).
- `packages/geotiff/src/source/` directory itself (becomes empty).
- `Overview.ensureTagsLoaded()` bulk-prefetch path.
- The `prefetch`, `multiplier`, `maxGap` options on `GeoTIFF.fromUrl`.

Net code change versus current `main`: small. We're adding ~5 lines to `fromUrl`, dropping 2 lines from `prefetchTags`, and undoing the `[SourceChunk, SourceCache]` → `[SourceReadaheadCache]` replacement that PR #509 made. Nothing more.

## API

`GeoTIFF.fromUrl(url, options)` signature:

```ts
static async fromUrl(
  url: string | URL,
  options: {
    /** AbortSignal for the header reads. */
    signal?: AbortSignal;
    /** Bytes per chunk for the header cache. Defaults to 64 KiB. */
    chunkSize?: number;
    /** Total cache size in bytes. Defaults to 8 MiB. */
    cacheSize?: number;
  } = {},
): Promise<GeoTIFF>
```

`chunkSize` and `cacheSize` are kept exposed (vs. hidden) because the previous design exposed similar knobs and removing all of them is gratuitously breaking. Defaults are tuned for the typical case; users almost never need to touch them.

## Tests

- **Unit:** `prefetchTags` no longer fetches `TileOffsets` / `TileByteCounts` (add an assertion against the existing test that exercises this path; verify the returned `CachedTags` has `tileOffsets: undefined` / `tileByteCounts: undefined` or removes those fields).
- **Integration:** open a fixture through `SourceFile` + the same `[SourceChunk, SourceCache]` stack used by `fromUrl`, verify it works end-to-end (read width/height/transform, fetch a tile).
- **Integration:** open a fixture, then disable `tiff.options`; assert that `image.getTileSize(0)` takes the `TileOffsets`/`TileByteCounts` path. (Indirect: count underlying source fetches and verify the leader-bytes 4-byte read does not appear.)
- **Regression:** `fromurl.test.ts` (the #524 workaround test) still passes after the option-shape change.

## Out of scope

- **Background pre-warming** of unvisited overviews. Easy to layer on later (call `image.fetch(TiffTag.TileOffsets)` from a `requestIdleCallback`).
- **Custom block-cache middleware.** `SourceChunk` + `SourceCache` from `@chunkd/middleware` is sufficient. No reason to roll our own.
- **Tunable cache replacement policy.** `SourceCache`'s two-generation eviction is good enough for now.

## References

- Reference implementation: [geotiff.js `BlockedSource`](https://github.com/geotiffjs/geotiff.js/blob/master/src/source/blockedsource.js)
- cogeotiff `getTileSize`: [`tiff.image.ts:568-596`](https://github.com/blacha/cogeotiff/blob/c489ebab2136a779a705bf1dedebbc250e17a747/packages/core/src/tiff.image.ts#L568-L596)
- cogeotiff `ImportantTags` (auto-loaded by `init(true)`): in `@cogeotiff/core/build/tiff.image.js:8-17`
- Previous design (superseded): [`2026-05-05-geotiff-readahead-cache-design.md`](2026-05-05-geotiff-readahead-cache-design.md)
