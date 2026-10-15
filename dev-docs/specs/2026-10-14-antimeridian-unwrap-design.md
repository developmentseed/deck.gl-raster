# Render imagery across the antimeridian with one unwrapped mesh

- **Date:** 2026-10-14
- **Issues:** [#171](https://github.com/developmentseed/deck.gl-raster/issues/171) (imagery crossing ±180°), [#366](https://github.com/developmentseed/deck.gl-raster/issues/366) (global COG tiles at ±180° never converge)
- **Status:** Implemented in [#714](https://github.com/developmentseed/deck.gl-raster/pull/714)
- **Supersedes:** [`2026-05-27-antimeridian-crossing-tile-design.md`](./2026-05-27-antimeridian-crossing-tile-design.md) (cut each crossing tile in two), and the approaches in [#269](https://github.com/developmentseed/deck.gl-raster/pull/269), [#374](https://github.com/developmentseed/deck.gl-raster/pull/374), [#576](https://github.com/developmentseed/deck.gl-raster/pull/576) and [#673](https://github.com/developmentseed/deck.gl-raster/pull/673)
- **Builds on:** [#518](https://github.com/developmentseed/deck.gl-raster/pull/518) (tile selection across world copies), [#574](https://github.com/developmentseed/deck.gl-raster/pull/574) (initial triangulations), [#711](https://github.com/developmentseed/deck.gl-raster/pull/711) (output-pixel error)

## Problem

"Antimeridian" covers three separate problems:

- **A.** Tile selection across world copies (#517). Fixed by #518.
- **B.** A global EPSG:4326 COG whose edge tile touches or overhangs ±180°
  never converges in Web Mercator (#366). So does an image that stops just
  short of 180° when its edge tiles are fetched as full blocks
  (`boundless: true`, as `MultiCOGLayer` does): the blocks' padding crosses
  180° though the image doesn't. #366's Digital Earth Pacific COG in EPSG:3832
  ends at 179.97°E, and its 512 px edge blocks run on to 180.07°E. `COGLayer`
  cuts edge tiles to the image, so it doesn't hit this.
- **C.** An image whose grid really crosses ±180°, such as a UTM zone 60 scene
  or an EPSG:4326 image stored from 170° to 190° (#171).

B and C are the same problem. The Web Mercator render path projects each tile
into deck.gl's common space with proj4, which always returns an x inside one
world copy, `[0, 512]`. For a tile that crosses 180°, the west corners come back
near x = 512 and the east corners near x = 0, so the tile's triangles stretch
across the whole world.

The GPU draws straight lines between corners, so its position for a point near
the seam lands mid-world, while the point belongs at the seam. The reprojector
measures that as a huge error and splits the triangle. Splitting can't fix it:
wherever the new vertex goes, some triangle still has corners on both sides of
the seam. Refinement piles up along the seam until the iteration cap (#366:
`error=43200` after 10,000 iterations), and the tile draws across the whole
world.

## Why the earlier design changed

The 2026-05-27 spec cut each crossing tile in two at the antimeridian, so that
each piece lies on one side and meshes normally. It rejected keeping the tile as
one mesh ("render-as-one") for three reasons:

1. Detecting crossing tiles needs phase unwrapping, and a whole-world tile must
   not be mistaken for a crossing one.
2. Mesh vertices leave `[0, 512]`.
3. The forward and inverse projections must agree on every world copy.

Output-pixel error (#711) changes the balance:

1. **Nothing is detected.** Every tile is unwrapped the same way, by walking
   out from its middle (below). A tile that doesn't cross comes out unchanged,
   and a whole-world tile stays a whole world wide.
2. **The finished mesh is clipped at the world edge,** so the vertices that
   reach the GPU are back in `[0, 512]`.
3. **Output mode never calls the inverse projection.** This is what sank #673's
   input-mode version. Its inverse had to accept x from any world copy and hand
   back longitudes on the image's own side (−204°, not 156°), which fails for
   datum-shifted geographic CRSs.

One mesh also handles a seam of any shape. UTM zone 60's seam is curved in the
image, which cut-in-two deferred.

## Approach

The reprojector builds one continuous mesh across the seam, in "unwrapped" x
that may run past the world's edge. The layer then clips it at the world edge
and moves each part back into `[0, 512]`.

### 1. Unwrap while meshing: `RasterReprojector`'s `wrapX`

`wrapX` is the period of the output x axis: one world, 512 in deck.gl common
space. It requires `_errorSpace: "output"`, and the constructor throws
otherwise. The snap happens in three places.

- **Error measurement.** A test point's exact position is compared with the
  copy nearest the GPU's position for it. Output mode already reuses that
  position when the test point becomes a vertex, so the new vertex lands next
  to its neighbors, not a world away. This is right as long as the true error
  is under half a world, which holds once the corners are in one copy, except
  right at a pole.
- **Seed corners.** These have no triangle to compare against yet. Each one is
  unwrapped by walking the straight UV path to it from the center of the
  seed's UV bounds, and snapping each step to the copy nearest the step before
  (`unwrapAlong`). The steps are halved until each moves less than a quarter of
  a world. A plain nearest-copy guess would collapse a 360°-wide image: proj4
  returns both its edges at the same x. The walk starts at the center, not at
  a corner, because a corner can be a pole, where longitude is undefined.
- **Pixel size**, output mode's unit. The half-pixel steps around the seed's
  center are differenced modulo the period. Otherwise a seed centered on the
  seam, as for a 0..360° image, measures a pixel as wide as the world and
  every error reads far too small.

The walk assumes the forward projection is continuous along the path. A tile
that contains a pole has no continuous unwrap, because longitude winds around
the pole. Meshing such a tile across the antimeridian is out of scope. Only
grids whose rows are parallels get clamped short of the pole in Web Mercator,
so a polar grid's tiles still reach it. Tile selection handles them (below).

### 2. Clip at the world edge: `RasterLayer`

Each triangle that crosses a multiple of the period is clipped against those
lines (Sutherland–Hodgman). Each part is shifted back by whole worlds into
`[0, 512]` and fan-triangulated. A new vertex on a cut edge gets its UV by
linear interpolation along that edge, which is exact because the GPU
interpolates UVs linearly across the triangle anyway. Triangles that don't
cross keep their shared vertices, so a mesh that lies in one world is
unchanged. The debug overlay draws the clipped mesh.

`RasterLayer` takes the period as an `@internal` `_wrapX` prop and passes it to
the reprojector.

### 3. Tiles: `RasterTileLayer`

Web Mercator tiles get `_wrapX: 512` when `_errorSpace` is `"output"`. The globe
has no seam and draws a uniform grid, so it is untouched. Input mode doesn't get
`_wrapX`, so a crossing tile still fails to mesh there, as it does today. A
follow-up PR removes input mode from the layers. Tile selection, below, changes
in both modes.

### 4. Tile selection: traversal

- **Bounding volume.** Each reference point is unwrapped from the tile's center
  with `unwrapAlong`, so a crossing tile's box hugs the tile instead of
  spanning the world.
- **Around a pole.** A tile that contains a pole winds through every
  longitude, so its unwrapped reference points can spread over more than a
  world and leave a gap between the box and its copy. A box half a world wide
  or more is widened to the whole world instead.
- **The other side.** A box that crosses the world's edge is also tested one
  world over. That is where the clipped mesh draws the tile's other part. So
  either part alone in view selects the tile, with or without `repeat`, and
  without running every world-copy pass for every tile.
- **Dataset bounds.** The pre-filter that compares a tile's box with the
  dataset's bounds also allows a one-world shift. The dataset's bounds come
  from `transformBounds`: a longitude/latitude source keeps longitudes like
  −204°, while a projected source's come back between −180° and 180°. So a
  tile's box and the dataset's bounds can land a world apart.

### 5. Debug tile outlines

Each corner's longitude is unwrapped by walking the tile's edge to it from
the previous corner. Steps of 90° or more are split, and `PathLayer` cuts the
path at ±180° (`wrapLongitude`). Without this, a crossing tile's outline runs
the long way around the world, and a whole-world tile's outline collapses. The
outline still joins the corners with straight lines, as before.

## Testing

**Never the long way around.** For every crossing image, these must hold:

- The unwrapped mesh spans the image's true width in longitude, never a world
  minus it.
- No triangle spans more than half a world. The exception is a whole-world
  image, whose seed triangles really do span the world.
- After clipping, every vertex is in `[0, 512]`, and the image has parts at
  both edges of the world.
- A −180..180° image stays a full world wide.

**Reprojector**

- A crossing tile gets the same mesh as the same tile moved off the seam.
- `wrapX` leaves a tile that doesn't cross unchanged.
- The pixel size of a seed centered on the seam is right.
- A polar tile with the pole at a corner meshes as it would without `wrapX`.
- An EPSG:3832 edge block whose padding crosses 180°, though its image
  doesn't, meshes the short way.
- `wrapX` without output mode, or with a period that isn't finite and
  positive, throws.

**Clipping:** unit tests for one copy, a crossing triangle, a mesh that lies
entirely one world over, a triangle across three worlds, a position that isn't
finite, and UV interpolation on cut edges.

**Fixtures.** The five antimeridian fixtures in `fixtures/geotiff-test-data`
run through the real geotiff descriptor and proj4: EPSG:4326, rotated, UTM 60N,
EPSG:3832, and edge to edge.

- Every tile of every level converges in output mode and meets the invariants
  above.
- The image is selected with the view centered on the seam and on either side
  of it alone, with and without `repeat`.

**Traversal:** unit tests for the other-side test, the dataset-bounds shift,
and a polar stereographic grid (NSIDC's EPSG:3413 extent), which must be
selected at every longitude.

**By eye:** `cog-basic` gets the fixtures as sources, viewed in Chrome with the
debug overlay.

## Scope

**In scope:** Web Mercator in output mode, for every layer built on
`RasterTileLayer` (`COGLayer`, `ZarrLayer`, `MultiCOGLayer`'s tiles).

**Out of scope:**

- Input mode, which a follow-up PR removes from the layers.
- The globe.
- `MosaicLayer` and `MultiCOGLayer` source bounds, covered by
  [#639](https://github.com/developmentseed/deck.gl-raster/pull/639).
- Tiles that contain a pole.
- [#713](https://github.com/developmentseed/deck.gl-raster/issues/713): tiles
  centered on the equator never converge. That is unrelated to the seam, but
  whole-world tiles hit it.
- An antimeridian scenario for the reprojection explainer. That is the next PR,
  and it replaces [#703](https://github.com/developmentseed/deck.gl-raster/pull/703).
