# Center-out tile loading

**Date:** 2026-04-24
**Status:** Implemented in [#477](https://github.com/developmentseed/deck.gl-raster/pull/477)

## Problem

Tiles are currently initiated for loading in the order returned by
`Tileset2D.getTileIndices`. In both `RasterTileset2D` and `MosaicTileset2D`
that order is not spatially biased — for raster it reflects quad-tree
traversal order, and for mosaic it reflects Flatbush query order. The
practical result is that on a fresh load or sudden viewport change, tiles
appear first near one edge of the viewport (typically top-left for the raster
path) rather than near the center where the user's attention is.

## Goal

On viewport change, initiate tile loads in order of increasing distance from
the viewport center, so the screen fills in from the user's focal point
outward.

This is an ordering change only. It does not change which tiles are selected,
which are evicted, or how placeholder/parent fallbacks render.

## Non-goals

- Changing the cull set or tile selection criteria.
- Changing the decoder pool, fetch concurrency, or any cache / eviction
  behavior.
- Guaranteeing center-first *completion*. Browser and server behavior
  determine actual paint order. We control only initiation order.
- A user-facing configuration surface. Center-out is strictly better than the
  current order; no prop is added.

## Scope

Two files get sort logic appended, plus one new shared helper module
exposing two functions (one low-level, one viewport-aware wrapper):

- `packages/deck.gl-raster/src/raster-tileset/raster-tileset-2d.ts` — `RasterTileset2D.getTileIndices`
- `packages/deck.gl-geotiff/src/mosaic-layer/mosaic-tileset-2d.ts` — `MosaicTileset2D.getTileIndices`
- `packages/deck.gl-raster/src/raster-tileset/sort-by-distance.ts` — new helper module. The viewport-aware `sortItemsByDistanceFromViewportCenter` is the function call sites use; it's re-exported across packages as `_sortItemsByDistanceFromViewportCenter` (underscore prefix marks it as an internal cross-package API, not a stable public surface). The underlying `sortByDistanceFromPoint` is exported only from the module file for direct unit testing.

## Design

### Performance budget

This runs on every viewport update, synchronously, before `getTileData` is
invoked. The budget is **well under one millisecond** for typical tile
counts (tens to low hundreds), and should be invisible on a flame graph
next to the surrounding viewport-update work.

Implementation constraints to hit this:

1. **Compute each tile's center exactly once per `getTileIndices` call.**
   Decorate-sort-undecorate: a single O(n) pre-pass computes each
   squared-distance; the comparator reads precomputed numbers only.
2. **No `Math.sqrt`.** Squared distance preserves ordering.
3. **No closure allocation inside the comparator.** The comparator is a
   plain `(a, b) => a - b` over a number, not a generic callback.
4. **Short-circuit when the sort cannot affect initiation order.** If
   `n <= maxRequests` all tiles start in parallel and ordering is moot;
   skip the sort entirely at the call site. `Tileset2DProps.maxRequests`
   is non-nullable in the call sites we control, so the check is a plain
   `n <= maxRequests`. The helper additionally short-circuits on `n < 2`
   so that pathological inputs are still safe.
5. **Avoid an intermediate `{d, item}[]` array when cheap to do so.**
   Use a parallel `Float64Array` of squared distances plus a
   `Uint32Array` index permutation; reorder the input array in-place (no
   new output array allocation) since the input is already a freshly
   produced array owned by `getTileIndices`.

### Shared helper

`sort-by-distance.ts` exposes two functions. The viewport-aware
`sortItemsByDistanceFromViewportCenter` is what the two call sites use; it
delegates to the lower-level `sortByDistanceFromPoint` for the actual
sort.

#### `sortItemsByDistanceFromViewportCenter` (call-site entry point)

```ts
export function sortItemsByDistanceFromViewportCenter<T>(
  items: T[],
  viewport: Viewport,
  getCenter: (item: T) => readonly [number, number],
): T[];
```

- Derives the reference point from `viewport.getBounds()` midpoint
  (WGS84). Encapsulates the bounds-destructuring and midpoint math so
  both call sites stay one-liner.
- `getCenter` returns each item's center in WGS84 — callers working in a
  projected CRS run their item centers through their descriptor's
  `projectTo4326` first.
- This is the only function exposed across packages, re-exported from
  the package root as `_sortItemsByDistanceFromViewportCenter` (the
  underscore marks it as an internal cross-package API, not a stable
  public surface — see [#477](https://github.com/developmentseed/deck.gl-raster/pull/477)
  review thread).

#### `sortByDistanceFromPoint` (low-level sort)

```ts
/**
 * Sort `items` in-place by ascending squared distance of each item's center
 * from `reference`. The input array is mutated and returned.
 *
 * `getCenter` is called exactly once per item (O(n) pre-pass), not once per
 * comparison. The comparator operates on a precomputed Float64Array.
 */
export function sortByDistanceFromPoint<T>(
  items: T[],
  opts: {
    getCenter: (item: T) => readonly [number, number];
    reference: readonly [number, number];
  },
): T[];
```

- **Sorts in place** and returns the same array. The input is always a
  freshly produced array from `getTileIndices`, so in-place is safe.
- Short-circuits to a no-op when `items.length < 2`. Caller-side
  short-circuits (e.g. `n <= maxRequests`) are applied before the helper
  is invoked.
- Internally builds a parallel `Float64Array` of squared distances and a
  `Uint32Array` index permutation, sorts the permutation, then shuffles
  items in place. No `{d, item}[]` decoration array.
- Sort key is squared Euclidean distance (no `sqrt`).
- Deterministic tiebreaker: on equal distance, preserve the original
  index. This falls out of the stable `Array.prototype.sort` spec when
  the comparator returns 0 for equal keys — we rely on that rather than
  encoding a tiebreaker explicitly.
- Space-agnostic: the caller picks the coordinate space. Exported only
  from the module file (not re-exported from the package) so unit tests
  can target it directly; production call sites should go through
  `sortItemsByDistanceFromViewportCenter`.

### `RasterTileset2D.getTileIndices`

After computing `tileIndices`:

1. If `tileIndices.length <= this.opts.maxRequests`, return as-is. No
   sort needed.
2. Hand off to `sortItemsByDistanceFromViewportCenter(tileIndices,
   viewport, getCenter)`. The helper derives the WGS84 reference from
   `viewport.getBounds()` midpoint.
3. `getCenter` for each tile reads
   `descriptor.levels[z].projectedTileCorners(x, y)`, takes the midpoint
   of `topLeft` and `bottomRight` (two corner reads, one add+shift — no
   need to touch all four corners), and projects that center to WGS84
   via `descriptor.projectTo4326`.

Hot path: one `projectedTileCorners` call plus one `projectTo4326` call
per tile, one subtract+multiply+add per tile into the distance array,
`sort` on the permutation, in-place shuffle.

**Why WGS84 instead of common/world space.** `viewport.center` exists but
is in deck.gl common-world space (e.g. ~[270, 327] for a WebMercator
viewport in the western hemisphere), which is not directly comparable to
projected tile corners in the tileset's CRS. Working in WGS84 sidesteps
that mismatch: `viewport.getBounds()` is always WGS84, and the descriptor
already exposes `projectTo4326` to bring projected tile centers into the
same space. This also subsumes the `_GlobeViewport` case (no special path
needed — bounds-based reference works on globe too). The trade-off is one
extra `projectTo4326` call per tile in the hot path.

### `MosaicTileset2D.getTileIndices`

After `built.index.search(...viewportBounds)` resolves source indices:

1. If the result length `<= this.opts.maxRequests`, return as-is. No
   sort needed.
2. Hand off to `sortItemsByDistanceFromViewportCenter(sources, viewport,
   getCenter)`. Mosaic sources already carry WGS84 bboxes, so no
   projection is needed.
3. `getCenter` for each source is the midpoint of its `bbox`:
   `[(minX+maxX) * 0.5, (minY+maxY) * 0.5]`. No function call, no object
   allocation per item beyond what the helper already owns.

### Why no configuration prop

- Top-left initiation has no use case anyone would opt into.
- The sort is O(n log n) on a tile count bounded at tens to low hundreds;
  the fixed-cost pre-pass dominates and is still sub-millisecond.
- Fewer knobs = less test/maintenance surface.

## Testing

Unit tests only; no integration tests added. The observable effect is
indirectly visible through initiation order, which is hard to assert at the
integration level without flakiness.

### `sort-by-distance.test.ts`

- Items equidistant from reference retain their original relative order
  (stable sort).
- Item at the reference point comes first.
- Input array is mutated in place and the returned reference is the same
  array.
- Ordering is correct for a ring of points around a non-origin reference.
- `getCenter` is called exactly `items.length` times (assert with a spy) —
  guards against a future regression where someone calls it from inside
  the comparator.
- Empty and single-item inputs return without error and without calling
  `getCenter`.

### `raster-tileset-2d` test addition

Using the existing test fixtures in
`packages/deck.gl-raster/tests/tileset-refinement.test.ts` (or a sibling
file if tighter isolation is preferred):

- Given a viewport whose center falls inside a specific tile, assert that
  tile is the first element of the returned array.
- Given a viewport centered between two equidistant tiles, assert the
  deterministic tiebreaker holds.

### `mosaic-tileset-2d` test addition

- Given a set of mosaic sources with known bboxes and a viewport covering
  all of them, assert the source whose bbox center is nearest the viewport
  center is first.
- Assert a source whose bbox does not intersect the viewport is excluded
  (regression guard — the sort must not disturb culling).

## Risks and open questions

- **Sort stability across JS engines.** `Array.prototype.sort` is stable
  per spec (ES2019+); this is what gives us deterministic ordering for
  equidistant tiles without an explicit tiebreaker.
- **Perf regression guard.** No CI benchmark is introduced (overkill for
  this change). Instead, the "getCenter called exactly n times" unit test
  catches the most likely regression — someone refactoring the helper to
  call `getCenter` inside the comparator.

## Out of scope / follow-ups

- Priority queue in the decoder pool. The pool is currently least-loaded
  dispatch, which is adequate for initiation-order-preserves-decode-order.
  Revisit only if we observe center-out failing to manifest at the user
  level.
- Predictive tile pre-fetching (motion-based biasing of the reference point
  toward where the viewport is moving).
