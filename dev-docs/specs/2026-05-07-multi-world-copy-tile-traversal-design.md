# Multi-world-copy tile traversal

**Issue:** [#517](https://github.com/developmentseed/deck.gl-raster/issues/517)

## Problem

`RasterTileLayer` already _renders_ tiles across multiple world copies — when zoomed
fully out you can see the dataset repeating east and west. The bug is that the tile
_traversal_ in
[`raster-tile-traversal.ts`](../../packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts)
only tests tile bounding volumes against the **primary** world copy's slice of
deck.gl common space (`x ∈ [0, 512]`).

When the viewport is panned across the antimeridian or zoomed in on the dataset's
shifted copy, frustum culling rejects every tile (because their bounding volumes
sit in `[0, 512]` and the camera frustum sits in `[512, 1024]` or `[-512, 0]`),
the layer gets an empty selection, and previously-loaded tiles are evicted. The
visible result is the dataset jumping between world copies as you pan, and tiles
disappearing from one side of the antimeridian when you zoom in on the other.

Upstream `@deck.gl/geo-layers` solves the same problem in its OSM tile traversal
([`tile-2d-traversal.ts`][upstream]) by re-running the traversal at world offsets
±1, ±2, … and OR-ing the per-tile `selected` flag.

## Goals

- Selected tiles cover the dataset across every visible world copy.
- Single-world viewports (no `repeat`, GlobeView) are bit-identical to today.
- No change to the layer/render pipeline — the upstream tile renderer already
  draws each `(x, y, z)` triple in every visible world copy.

## Non-goals

- Extending `createRootTiles` (the large-zarr-root cull path) to consider world
  copies. The issue's scenario uses a small root grid (≤ `MAX_ROOT_TILES_NO_CULL`)
  where every root tile is enumerated, so the bug is purely in the per-tile
  visibility test. Generalizing the root-cull path can be a follow-up if zarr
  datasets ever exhibit the same symptom.
- Globe view. `subViewports.length > 1` does not occur there.

## Approach

Match the upstream model: one `RasterTileNode` tree, multiple `update()` passes
with a `worldOffset` parameter. Each pass tests the same tile's bounding volume,
translated by `worldOffset * TILE_SIZE` (= 512) along the common-space X axis,
against the camera frustum. A tile is selected if **any** pass selects it.

### Why this over alternatives

- **Recompute the OBB per pass (no caching across offsets):** simpler code path,
  but throws away the current `_boundingVolume` cache that's load-bearing for
  zarr root grids. Translation is O(1); recomputation is not.
- **One independent tree per offset, then deduplicate selected tiles by `(x, y, z)`:**
  cleanly avoids the additive-selection subtlety below, but doubles to quadruples
  memory and complicates the `getSelected` aggregation. Not worth it.
- **Union-frustum culling test (one big multi-world frustum):** would over-select.
  The actual visible region is N disjoint frusta, not their AABB.

## Components

### `RasterTileNode.update(params)`

Add `worldOffset: number` to `params` (default `0`).

- **Primary pass (`worldOffset === 0`):** unchanged. Resets `childVisible` and
  `selected` at the top, runs LOD, possibly recurses, and on the recursion branch
  may re-set `this.selected = false`.
- **Additional passes (`worldOffset !== 0`):** skip the top-of-method resets and
  skip the `this.selected = false` line in the recursion branch. Passes are
  purely **additive** — they can flip `selected` from `false` → `true` but never
  the reverse.

  Why: a tile's *frustum* visibility differs per pass (each tests the volume at
  a different offset). A tile selected at offset 0 must not be un-selected by a
  later pass that finds it out of frustum. Upstream's algorithm resets `selected`
  / `childVisible` at the top of `update` and on the recursion branch; running
  those resets on a non-zero pass would clear the tile and then fail its own
  frustum test, dropping it. Skipping the resets makes "selected at any offset"
  the actual semantics.

  Note the LOD test
  ```ts
  devicePixelsPerSourcePixel = (tileMetersPerPixel * pixelRatio) / metersPerCSSPixel
  ```
  is itself offset-invariant: `metersPerCSSPixel` derives from latitude only
  (`worldToLngLat` of the OBB center) and the offset translation is along X only,
  so the LOD decision is identical across passes. The gating is about frustum
  selection, not LOD.

Pass `worldOffset` through to `getBoundingVolume`.

### `RasterTileNode.getBoundingVolume(zRange, project, worldOffset)`

Add `worldOffset: number` (default `0`).

- The cached `_boundingVolume` continues to store the **offset-0** OBB and AABB
  per `zRange`. The cache key does **not** include `worldOffset`.
- When `worldOffset !== 0`, derive a translated result from the cached entry:
  - **OBB:** clone `boundingVolume.center` and add `worldOffset * TILE_SIZE` to
    its X component; reuse `halfAxes` unchanged. Construct a new
    `OrientedBoundingBox` rather than mutating the cached one.
  - **AABB (`commonSpaceBounds`):** shift `minX` and `maxX` by
    `worldOffset * TILE_SIZE`; `minY` / `maxY` unchanged.

Translation is allocated per call and not cached. Profiling can reduce that later
if it shows up.

### `getTileIndices(descriptor, opts)`

After the existing primary-pass loop:

```ts
for (const root of roots) {
  root.update({ ...traversalParams, worldOffset: 0 });
}

if ((viewport as any).subViewports && viewport.subViewports.length > 1) {
  for (const offset of walkOffsets(-1, -MAX_MAPS)) {
    if (!runPass(roots, offset)) break;
  }
  for (const offset of walkOffsets(1, MAX_MAPS)) {
    if (!runPass(roots, offset)) break;
  }
}
```

Where:

- `runPass(roots, offset)` calls `root.update({...traversalParams, worldOffset: offset})`
  for each root and returns `true` iff any root's call returned `true` (i.e.,
  any tile in that pass was visible).
- `walkOffsets(start, end)` yields `start`, `start ± 1`, … up to (and including)
  `end`, in the appropriate direction.
- `MAX_MAPS = 3`, matching upstream.

The activation condition `subViewports.length > 1` matches the user's preference
to avoid coupling to a specific viewport class. WebMercator with `repeat: true`
sets it; GlobeView does not.

### Bounds-check direction

`getTileIndices` derives `bounds` (in common space) from the dataset's WGS84
bounds via `lngLatToWorld`. That AABB is fixed at offset 0 — i.e., it represents
"where the dataset lives in the primary world copy."

A tile at `(x, y, z)` always represents the same data; at `worldOffset = N`
that data is _drawn_ at common-space X plus `N * 512`. To ask "does the drawn
position overlap the dataset bounds?" we compare the tile's translated AABB
against the original `bounds`. Equivalent to translating `bounds` by `−N * 512`,
but we already need to translate the tile AABB for the frustum test, so we
reuse it.

### `MAX_MAPS = 3`

Matches upstream. At zoom 0 with a Web Mercator world width of 512 common-space
units and a viewport ≤ ~7 world copies wide (corresponds to a viewport state
that's hard to reach in practice), 3 offsets per side covers everything plus
margin. The walk-until-empty short-circuit means the cap rarely binds.

## Data flow

```
getTileIndices
  ├── createRootTiles                                (unchanged)
  ├── for each root: root.update({offset: 0})         (primary pass)
  ├── if subViewports.length > 1:
  │     offset = -1, -2, ...   walk west, stop on empty pass / cap
  │     offset =  1,  2, ...   walk east, stop on empty pass / cap
  └── for each root: root.getSelected(...)            (unchanged)
```

## Testing

New file `packages/deck.gl-raster/tests/raster-tileset/world-copies.test.ts`:

1. **Eastward antimeridian wrap selects tiles.** Build a `WebMercatorViewport`
   with `repeat: true` whose camera looks at the dataset only via the
   `worldOffset = +1` copy (e.g., dataset centered at longitude `0`, camera
   centered at longitude `+360°` or equivalently the wrapped projection that
   produces a multi-world `subViewports` list). Assert `getTileIndices` returns
   a non-empty selection covering the dataset's tile range. Without the fix,
   the same viewport returns an empty selection.
2. **Westward wrap selects tiles.** Same as (1), camera at `−360°`.
3. **Selection across antimeridian split.** Camera straddles the antimeridian
   (e.g., longitude `±180°`) so both the offset-0 dataset and its offset-`±1`
   copy are partially in the frustum. Assert the selected tile set covers
   tiles needed for both visible halves (i.e., the tile range derived from
   both passes' visible regions, deduplicated by `(x, y, z)`).
4. **Single-world parity.** A viewport whose `subViewports` has length `1`
   returns the same tile set as before the change. Capture the
   pre-change selection as a fixture and assert equality.
5. **`MAX_MAPS` cap.** Construct a viewport whose frustum technically extends
   beyond `±MAX_MAPS` world copies (heavily zoomed-out or extreme aspect
   ratio) and assert `getTileIndices` returns within finite time. The cap
   binding is observable as the loop terminating at `±MAX_MAPS` rather than
   on an empty pass.
6. **Globe parity.** Pass a `_GlobeViewport`; assert tile selection is
   unchanged from before the fix (the multi-world branch is gated off).

Test infrastructure mirrors the existing
[`raster-tileset/create-root-tiles.test.ts`](../../packages/deck.gl-raster/tests/raster-tileset/create-root-tiles.test.ts)
and
[`raster-tileset/lod-pixel-ratio.test.ts`](../../packages/deck.gl-raster/tests/raster-tileset/lod-pixel-ratio.test.ts):
use real `WebMercatorViewport` instances where possible, fall back to viewport
stubs (`as any` for `subViewports`) only when the real viewport doesn't expose
the needed shape.

## Documentation

New `dev-docs/world-copies.md`: short explainer (~1 page) covering:

- The world-offset model: tiles are stored at offset 0; rendering replicates
  them; traversal must test all visible offsets.
- Why we re-run `update()` per offset rather than computing one big frustum.
- Why `worldOffset !== 0` passes are additive (the LOD-flip subtlety).
- Pointer to upstream prior art ([`tile-2d-traversal.ts`][upstream]).

Linked from `dev-docs/README.md`.

## Out-of-scope follow-ups

- Generalizing `createRootTiles` to consider world-copy intersections for the
  large-root-grid path. Track separately if a zarr dataset surfaces this.
- Caching translated bounding volumes per `(zRange, worldOffset)` pair if
  profiling shows the per-call allocation matters. Current expectation: it
  doesn't.

[upstream]: https://github.com/visgl/deck.gl/blob/b0134f025148b52b91320d16768ab5d14a745328/modules/geo-layers/src/tileset-2d/tile-2d-traversal.ts
