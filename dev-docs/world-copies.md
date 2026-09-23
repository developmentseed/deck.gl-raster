# Multi-world-copy tile traversal

[`raster-tile-traversal.ts`](../packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts)
selects tiles by frustum-culling each tile's bounding volume against the
camera. In Web Mercator with `repeat: true`, the camera can see multiple
copies of the world simultaneously — the dataset's tiles are stored once but
rendered shifted by N × 512 units along common-space X. Without world-copy
support the traversal would only test tiles in their primary [0, 512] slice,
so panning across the antimeridian evicts visible tiles. See
[#517](https://github.com/developmentseed/deck.gl-raster/issues/517).

## Model

- A tile is identified by `(x, y, z)`. Its data and primary-world common-space
  position are computed once (see `RasterTileNode.getBoundingVolume`) and
  cached.
- For a viewport with `subViewports.length > 1` (Web Mercator + `repeat: true`
  whose bounds straddle ±180°), the traversal additionally tests each tile's
  bounding volume **translated** by `worldOffset * 512` along common-space X
  for `worldOffset` in `±1, ±2, … ±MAX_MAPS`.
- A tile is selected if it passes the frustum test at **any** offset.
- Selected tile indices are returned as `(x, y, z)` triples — the rendering
  pipeline already handles drawing each tile in every visible world copy.

## Why re-run the traversal instead of expanding the frustum

The visible region is N disjoint frusta (one per world copy), not their
bounding box. A single "big" frustum union would over-select. Per-offset
traversal exactly mirrors the actual visibility.

## Why non-zero passes are additive

Each pass tests the same tile against the frustum at a *different* world
offset, so a tile's frustum visibility differs between passes — that's the
whole point (a tile out of frustum at offset 0 may be in frustum at offset
±1). The danger is the reverse direction: a tile *selected* at offset 0 must
not be un-selected by a later pass that finds it out of frustum. Upstream's
algorithm resets `selected` / `childVisible` to `false` at the top of
`update` and on the recursion branch; if those resets ran on every pass, the
offset ±1 pass would clear a tile the primary pass selected and then fail its
own frustum test, dropping the tile. So non-zero passes skip the resets,
making them purely additive: they may flip `selected` / `childVisible` from
`false` → `true` but never the reverse. Implemented by gating the per-frame
resets on `worldOffset === 0`.

Note the LOD test itself is *offset-invariant*: `metersPerCSSPixel` derives
from latitude only (`worldToLngLat` of the OBB center) and the world-offset
translation is along common-space X only, so `devicePixelsPerSourcePixel` —
and thus the LOD decision — is identical across passes. The additive gating
is purely about preserving frustum-driven selection, not about LOD.

## Bounds check uses the offset-0 AABB

A tile at `(x, y, z)` represents the same data regardless of which world copy
it's drawn in. The dataset's `bounds` parameter (passed to
`RasterTileNode.update`) lives in primary-world common space. So the bounds
check always compares against the **untranslated** tile AABB — only the
frustum test sees the translated bounding volume.

## Termination

The traversal walks offset = ±1, ±2, ... until either:

- A pass selects no tiles (the offset has moved past the visible range), or
- The cap `MAX_MAPS = 3` is reached.

Walk-until-empty terminates quickly in practice. The cap exists to bound
worst-case behavior at extreme zoom-outs and aspect ratios.

## Prior art

The pattern matches `@deck.gl/geo-layers`'s OSM tile traversal:
[`tile-2d-traversal.ts`](https://github.com/visgl/deck.gl/blob/b0134f025148b52b91320d16768ab5d14a745328/modules/geo-layers/src/tileset-2d/tile-2d-traversal.ts).
Differences:

- Our bounding volumes are `OrientedBoundingBox` (because tiles can be in
  arbitrary CRS), so translation requires constructing a fresh OBB rather
  than mutating an axis-aligned box.
- We cache the offset-0 OBB per `(zRange)` and translate from the cache
  rather than recomputing per offset.

## A second, independent layer: MosaicTileset2D source selection

This file focusses primarily on how *pixel tiles* are selected within an already-open COG, inside
`RasterTileLayer`. A separate concern sits one level up: `MosaicLayer`'s
[`MosaicTileset2D`](../packages/deck.gl-geotiff/src/mosaic-layer/mosaic-tileset-2d.ts)
decides which `sources` (each `{ id?, bbox }`, see
`MosaicSource`) are visible at all via a Flatbush spatial query over source
bboxes *before* any `RasterTileLayer` for that source exists. `viewport.getBounds()`
returns unwrapped longitudes once the camera pans past ±180°, so a single,
un-repeated query misses sources whose bbox sits on the far side of the seam.
A source that's never selected here never gets a `RasterTileLayer`, so the
fix above can't help it.

The fix mirrors this doc's model: `subViewports.length > 1` gate and same
`MAX_MAPS` walk-until-empty pattern but shifts the *query bounds* by
`worldOffset * 360°` of longitude instead of translating a bounding volume by
`worldOffset * 512` in common space, since Flatbush operates on WGS84
degrees, not deck.gl common space. Matches are deduplicated across offsets
(a `Set`) since the same source can satisfy more than one offset's query at
once (e.g. a source near the prime meridian at extreme zoom-out).

## Out of scope

- The large-zarr-root cull path in `createRootTiles` does not yet consider
  world-copy intersections. For typical OGC pyramids this doesn't matter
  (root tiles are enumerated unconditionally). If a zarr dataset hits the
  same symptom, generalize that path.
- Antimeridian issues such as COGs whose bbox crosses ±180° in WGS84 longitude will be handled separately.
