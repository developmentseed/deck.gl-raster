# Route `fetchTiles` through batched `getTiles` / `getMultipleBytes`

**Date:** 2026-05-12
**Issue:** [#407](https://github.com/developmentseed/deck.gl-raster/issues/407)
**Status:** Design — builds on [#530](https://github.com/developmentseed/deck.gl-raster/pull/530) (which vendored `getTiles` / `getMultipleBytes` / `coalesceRanges` but left `fetchTiles` unchanged).

## Background

`fetchTiles` was added in [#406](https://github.com/developmentseed/deck.gl-raster/pull/406) but currently just does `Promise.all(xy.map(fetchTile))` — one independent HTTP range request (or `N` for band-planar COGs) per tile. Its only consumer today, `multi-cog-layer.ts`, calls it with a small grid of spatially-adjacent covering tiles, whose byte ranges in a COG are typically contiguous or near-contiguous on disk — the exact case range coalescing helps. A follow-up plan is to also feed deck.gl's per-tile fetches through `fetchTiles` (a debounce-coalesce middleware, [#273](https://github.com/developmentseed/deck.gl-raster/issues/273)), so `fetchTiles` is becoming a central batched-read primitive rather than a multi-cog helper.

[#530](https://github.com/developmentseed/deck.gl-raster/pull/530) vendored the pieces needed (from [cogeotiff PR #1463](https://github.com/blacha/cogeotiff/pull/1463)):

- `coalesceRanges(dataSource, ranges, opts)` — merges nearby byte ranges into fewer `dataSource.fetch` calls.
- `getMultipleBytes(image, ranges, dataSource, opts)` — vectorized `getBytes`; dispatches through `coalesceRanges`; returns one entry per input range in input order, `null` for sparse ranges.
- `getTiles(image, xy, dataSource, opts)` — resolves each tile's offset/size via `image.getTileSize` (header source, chunk-cached), then fetches the data via `getMultipleBytes`.

This change wires `fetchTiles` onto those helpers.

## Goals

1. `fetchTiles` issues coalesced batched range requests for the data tiles (and the mask tiles, if any) instead of `N` independent ones.
2. Both planar configurations benefit: pixel-interleaved (`Contig`) and band-planar (`Separate`). Band-planar is the worst case today (`N × bands` independent requests).
3. No behavior change for `fetchTile`, and no behavior change for `fetchTiles` other than the I/O batching (same results, same order, same errors).

## Non-goals

- Exposing `coalesce` / `maxRangeSize` knobs through `fetchTiles`' options object. Use `coalesceRanges` defaults; add knobs later if needed.
- Unifying `fetchTile` onto the batched path (`fetchTile = fetchTiles([[x,y]])[0]`) or deleting `getTile` / `fetchCogBytes` / `fetchBandSeparateTileBytes`. `fetchTile` keeps its existing single-range I/O path.
- The deck.gl debounce-coalesce middleware ([#273](https://github.com/developmentseed/deck.gl-raster/issues/273)).

## Solution

Split `fetchTile`'s body into "fetch the compressed bytes" and "decode + assemble the `RasterArray`". `fetchTile` and `fetchTiles` share the second half; only the I/O half differs.

```
fetchTile(self, x, y, opts)                         ← I/O path unchanged
  ├─ fetchCogBytes(self, x, y, {signal})                       (1 range; N for band-planar)
  ├─ maskImage ? getTile(maskImage, x, y, dataSource, …) : null
  └─ assembleTile(self, x, y, tileBytes, maskBytes, {boundless, pool})   ←★ extracted

fetchTiles(self, xy, opts)                          ← rewritten
  ├─ data:  fetchCogBytesMultiple(self, xy, {signal})          ←★ new
  │           Contig    → getTiles(self.image, xy, dataSource, {signal, debug:"data"})
  │                       map null → throw `Tile at (x, y) not found`
  │           Separate  → fetchBandSeparateTileBytesMultiple(self, xy, {signal})   ←★ new
  │                       Promise.all(findBandSeparateTileByteRanges per tile)
  │                       → flatten (tile × band) ranges → one getMultipleBytes call
  │                       → regroup `bands.length` results per tile; null → throw
  ├─ mask:  maskImage ? getTiles(self.maskImage, xy, dataSource, {signal, debug:"mask"})
  │                   : xy.map(() => null)
  └─ const [data, mask] = await Promise.all([dataPromise, maskPromise])
     Promise.all(xy.map(([x,y], i) => assembleTile(self, x, y, data[i], mask[i], {boundless, pool})))
```

`assembleTile` is exactly the post-fetch tail of today's `fetchTile`: `getUniqueSampleFormat` → build `decoderMetadata` → `decodeTile` / `decodeMask` (concurrent) → build `RasterArray` → `clipToImageBounds` when `boundless === false`. Pure relocation.

Net: one extraction (`assembleTile`) plus three small new functions (`fetchCogBytesMultiple`, `fetchBandSeparateTileBytesMultiple`, and `fetchTiles` rewritten). No new dependencies.

### Why flatten band ranges *and* tile ranges into one `getMultipleBytes`?

For a band-planar COG, tile `(x, y)`'s `N` bands live in `N` different regions of the file, and the same band of adjacent tiles is contiguous. Flattening every `(tile, band)` range into a single `getMultipleBytes` call lets `coalesceRanges` merge across both axes. Regrouping afterwards is mechanical: results come back in input order, so slice `bands.length` per tile (the band count is fixed across tiles).

### Error / edge behavior — mirrors `fetchTile`

- `getTiles` returns `null` for a sparse data tile → throw `Tile at (x, y) not found` (same message `fetchCogBytes`/`fetchBandSeparateTileBytes` throw today).
- `null` band slot in a band-planar tile → same throw.
- `xy.length === 0` → return `[]`, no I/O (matches `getTiles`/`getMultipleBytes`).
- Data and mask batches run concurrently (`Promise.all`).
- `_debug` → pass `{ label: "data" }` / `{ label: "mask" }`; per-fetch logging now reports the post-coalesce ranges.

### Doc / comment cleanup

- Rewrite the `fetchTiles` JSDoc — it currently says "For now, this simply calls `fetchTile` in parallel"; describe the batched coalesced behavior and `@see getTiles`.
- Delete the stale `// TODO: coalesce contiguous byte ranges for fewer HTTP requests` line.

## Testing

Integration tests in `packages/geotiff/tests/fetch.test.ts`, against the real fixtures (same style as the existing `fetchTile` tests):

1. **Contig correctness** — `fetchTiles` over a 2×2 grid on a multi-tile deflate fixture deep-equals `[await fetchTile(x,y), …]` (x, y, layout, data bytes, dims, transform, nodata, crs).
2. **Band-separate correctness** — same against `int8_3band_zstd_block64`.
3. **Order preserved** — shuffled `xy` input round-trips to the matching per-tile results.
4. **`boundless: false` propagates** — edge tiles clipped, via the `uint8_1band_deflate_block128_unaligned` fixture.
5. **Mask parity** — `cog_uint8_rgb_mask` fixture: `fetchTiles` tiles carry the same `mask` as `fetchTile`.
6. **Coalescing actually happens** — open the fixture with `GeoTIFF.open` passing a `dataSource` wrapped in a `.fetch()`-call-recording proxy; `fetchTiles` over an adjacent grid issues strictly fewer `.fetch()` calls than the tile count, and the bytes still decode identically to `N × fetchTile`.
7. **Empty input** — `fetchTiles([])` → `[]`, zero fetches.

If `cog_uint8_rgb_mask` turns out to be single-tile (no adjacent grid possible), test 5 still works as a 1×1 parity check; tests 1/3/6 use a larger fixture.
