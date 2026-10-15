# Render imagery across the antimeridian with one unwrapped mesh

- **Date:** 2026-10-14
- **Issues:** [#171](https://github.com/developmentseed/deck.gl-raster/issues/171) (imagery crossing the antimeridian), [#366](https://github.com/developmentseed/deck.gl-raster/issues/366) (global COG tiles at 180° never converge)
- **Status:** Implemented
- **Supersedes:** [`2026-05-27-antimeridian-crossing-tile-design.md`](./2026-05-27-antimeridian-crossing-tile-design.md) (cut each crossing tile in two), and the approaches in [#269](https://github.com/developmentseed/deck.gl-raster/pull/269), [#374](https://github.com/developmentseed/deck.gl-raster/pull/374), [#576](https://github.com/developmentseed/deck.gl-raster/pull/576), [#673](https://github.com/developmentseed/deck.gl-raster/pull/673) and [#714](https://github.com/developmentseed/deck.gl-raster/pull/714)
- **Builds on:** [#518](https://github.com/developmentseed/deck.gl-raster/pull/518) (tile selection across world copies), [#574](https://github.com/developmentseed/deck.gl-raster/pull/574) (initial triangulations), [#711](https://github.com/developmentseed/deck.gl-raster/pull/711) (output-pixel error)

## Problem

"Antimeridian" covers three separate problems:

- **A.** Tile selection across world copies (#517). Fixed by #518.
- **B.** A global EPSG:4326 COG whose edge tile touches or overhangs 180° never
  converges in Web Mercator (#366). So does an image that stops just short of
  180° when its edge tiles are fetched as full blocks (`boundless: true`, as
  `MultiCOGLayer` does): the blocks' padding crosses 180° though the image
  doesn't. #366's Digital Earth Pacific COG in EPSG:3832 ends at 179.97°E, and
  its 512 px edge blocks run on to 180.07°E. `COGLayer` cuts edge tiles to the
  image, so it doesn't hit this.
- **C.** An image whose grid really crosses 180°, such as a UTM zone 60 scene
  or an EPSG:4326 image stored from 170° to 190° (#171).

B and C are the same problem. The Web Mercator path projects each tile into
deck.gl's common space with proj4, which always returns an x inside one world,
`[0, 512]`. For a tile that crosses 180°, the west corners come back near
x = 512 and the east corners near x = 0, so the tile's triangles stretch across
the whole world.

The GPU draws straight lines between corners, so its position for a point near
the seam lands mid-world, while the point belongs at the seam. The reprojector
measures that as a huge error and splits the triangle. Splitting can't fix it:
wherever the new vertex goes, some triangle still has corners on both sides of
the seam. Refinement piles up along the seam until the iteration cap (#366:
`error=43200` after 10,000 iterations), and the tile draws across the whole
world.

The same wrap breaks every other place that takes the extremes of projected
x or longitude: a crossing tile's bounding box spans the world, so the tile is
selected everywhere; its debug outline goes the long way around; and
`getGeographicBounds` spans the world, so the examples' fly-to zooms out to
the far side of it.

## Where the fix lives

The fix makes the forward projection continuous across the wrap before the
mesh is built. Each layer keeps one job:

- **`RasterReprojector`** (`raster-reproject`) stays planar. It meshes a
  continuous map from one plane to another, and knows nothing about world
  copies, Web Mercator or longitudes.
- **`RasterLayer`** (`deck.gl-raster`) is a generic image layer. Told that its
  output x wraps with some period (`_wrapX`), it makes the image's projection
  continuous, meshes it, and cuts the mesh at the world's edge.
- **`RasterTileLayer`** knows it draws in Web Mercator's common space, whose x
  repeats every 512 units, and passes that period on. `COGLayer` and
  `ZarrLayer`, which know the CRSs, get this through it.
- **`nearestCopy` and `unwrapAlong`**, the helpers for values that wrap, live in
  `@developmentseed/proj` with the other projection helpers.

#714 did the unwrapping inside the reprojector instead: it moved each test
point to the copy nearest the GPU's position, walked the seed's corners from
its center, and differenced the pixel size modulo the period. Lifting the
projection gives the same meshes (the same triangle counts, x ranges and
widest triangles for EPSG:4326, UTM 60N, EPSG:3832 and EPSG:3031 tiles) and
leaves the reprojector untouched.

## Why the earlier design changed

The 2026-05-27 spec cut each crossing tile in two at the antimeridian, so that
each piece lies on one side and meshes normally. It rejected keeping the tile as
one mesh ("render-as-one") for three reasons:

1. Detecting crossing tiles needs phase unwrapping, and a whole-world tile must
   not be mistaken for a crossing one.
2. Mesh vertices leave `[0, 512]`.
3. The forward and inverse projections must agree on every world copy.

Output-pixel error (#711) changes the balance:

1. **Nothing is detected.** Every image is unwrapped the same way, walking out
   from its center (below). An image that doesn't cross comes out unchanged,
   and a whole-world image stays a world wide.
2. **The finished mesh is clipped at the world's edge,** so the vertices that
   reach the GPU are back in `[0, 512]`.
3. **Output mode never calls the inverse projection.** This is what sank #673's
   input-mode version. Its inverse had to accept x from any world copy and hand
   back longitudes on the image's own side (-204°, not 156°), which fails for
   datum-shifted geographic CRSs.

One mesh also handles a seam of any shape. UTM zone 60's seam is curved in the
image, which cut-in-two deferred.

## Approach

### 1. Values that wrap: `@developmentseed/proj`

- **`nearestCopy(x, ref, period)`** moves `x` by whole periods to the copy
  nearest `ref`.
- **`unwrapAlong(valueAt, { start, period })`** finds the unwrapped value at the
  end of a path, given the unwrapped value at its start. It moves each step to
  the copy nearest the step before, halving steps until each moves less than a
  quarter period. It always looks at the midpoint, so it finds two ends a whole
  period apart, like the two edges of a 360°-wide image, which proj4 returns at
  the same longitude.

### 2. Lift the projection: `makeUnwrappedReprojectionFns`

This wraps an image's reprojection functions so that its forward projection is
continuous across the wrap (`deck.gl-raster`, internal):

1. Unwrap the image's four corners by walking to each from the image's center
   with `unwrapAlong`. The walk stops just short of each corner, because a
   corner can be a pole, where x is undefined. A projection that gave NaN
   there would otherwise make every x NaN.
2. For each projected point, find its pixel with `inverseTransform`, blend the
   corners' x bilinearly at that pixel, and move the point's x to the copy
   nearest the blend.

Each point lands in the right copy as long as its x is within half a period of
the blend, which holds unless the image contains a pole. The result may run
past one period. The reprojector's pixel size, measured at the center of the
meshed area, comes out right without a special case, because the lifted
projection is continuous there too.

Only the forward projection changes: the inverse still expects x in one copy.
So the mesh must be built in output mode, which never calls it.

### 3. Mesh and clip: `RasterLayer`

`RasterLayer` takes the period as an `@internal` `_wrapX` prop. With it,
`RasterLayer`:

- raises an error unless `_errorSpace` is `"output"`;
- lifts the reprojection functions and runs the unchanged `RasterReprojector`;
- cuts the mesh at every multiple of the period with `clipMeshToWorld`, and
  moves each part back into `[0, period]`.

`clipMeshToWorld` clips each triangle that crosses a multiple of the period
against those lines (Sutherland-Hodgman), moves each part back by whole
periods, and fan-triangulates it. A new vertex on a cut edge gets its UV by
linear interpolation along that edge, which matches how the GPU interpolates
UVs across the triangle. Triangles that don't cross keep their shared
vertices, and a mesh that lies in one world comes back moved whole.

The debug overlay outlines the triangles of the mesh as drawn, read from the
same typed arrays the GPU draws, so it shows the cut.

### 4. Tiles: `RasterTileLayer`

`RasterTileLayer` draws every view except the globe in Web Mercator's common
space (`_projectPosition`, cartesian coordinates). That branch sets the period,
512, and each tile's `RasterLayer` gets it as `_wrapX` in output mode. The globe
draws a uniform grid in longitude and latitude, and doesn't wrap. Input mode
doesn't get `_wrapX`, so a crossing tile still fails to mesh there, as it does
on main. A follow-up PR removes input mode from the layers. Tile selection,
below, changes in both modes.

The branch treats every non-globe view as Web Mercator. Views in other
projections will need a second look.

### 5. Tile selection: traversal

- **Bounding volume.** Each of a tile's nine reference points is unwrapped by
  walking to it from the tile's center, in EPSG:3857 metres with one world as
  the period. So a crossing tile's box hugs the tile, and may run past the
  world's edge. Where the walk can't place a point, proj4's x is kept.
- **Wide tiles.** A box half a world wide or more becomes a whole-world box, at
  its latitudes. That covers tiles around a pole, which wind through every
  longitude and have no continuous unwrap. It also fixes a bug on main: a
  polar grid's root tile contains the pole, but its nine reference points came
  back between x = 58.7 and 495.5. A box can't wrap, so near the antimeridian
  (at 160°W, 55°N, for example) the root tile was culled, and no tile was
  selected.
- **The other part.** A box that runs past the world's edge is also tested one
  world over, where `RasterLayer` draws that part. So either part alone in view
  selects the tile, with or without `repeat`.
- **Dataset bounds.** The pre-filter that compares a tile's box with the
  dataset's bounds allows a one-world shift. The dataset's bounds come from
  `transformBounds`, which doesn't wrap: the EPSG:4326 fixture's bounds give x
  from -34 to 26, while its tile's box runs from 478 to 538.

### 6. Debug tile outlines

Each corner's longitude is unwrapped by walking the tile's edge to it from the
previous corner. The `PathLayer` then wraps longitudes (`wrapLongitude`),
cutting the path at the antimeridian. `wrapLongitude` takes each step the
short way around, so steps of more than 90° are split first, or a whole-world
tile's outline would collapse. The label goes at the tile's center, in the
world copy nearest 0°.

### 7. Geographic bounds: `getGeographicBounds`

The examples fly to an image's `geographicBounds`. Each corner's longitude is
unwrapped by walking the image's outline to it. West is moved into
[-180°, 180°) and east with it, so east may run past 180°, as MapLibre's
`fitBounds` accepts. An image that goes all the way around gets -180° to 180°.

### 8. Example: `cog-basic`

In development, cog-basic's Vite server serves the geotiff-test-data fixtures
at `/__fixtures/` with HTTP range requests, and the five antimeridian fixtures
appear in its image picker. Picking one switches to output mode and draws the
antimeridian over it, at both 180° and -180°, since only one is in the world
copy the map is centered in.

## Testing

**Never the long way around.** For every image that crosses:

- The unwrapped mesh is less than half a world wide, and crosses exactly one
  world edge.
- After clipping, every vertex is in `[0, 512]`, the image has a part at each
  edge of the world, and no triangle is wider than half a world.
- A -180..180° image stays a full world wide.

**Lift:**

- A crossing image meshes into exactly the same triangles as the same image
  moved off the seam.
- It goes the short way: 42° wide, not 318°.
- An image that doesn't cross is unchanged.
- A 0..360° image is a world wide, and its pixel size on the seam is right.
- With a projection that gives no x at a pole corner, the lifted mesh matches
  the unlifted one. Walking onto the pole would make every x NaN.

**Clip:** a mesh in one world, one world over, touching the edge, across the
edge (inside the world, the same area, UVs interpolated), across x = 0, across
three worlds, and with a position that isn't finite.

**`RasterLayer`:** the mesh rebuilds when `_wrapX` changes; a crossing image is
drawn inside the world, at both edges, with no triangle wider than half a
world; the debug overlay outlines exactly the drawn triangles; and `_wrapX`
without output mode raises an error.

**`RasterTileLayer`:** `_wrapX` is 512 in Web Mercator in output mode, and
unset in input mode and on the globe.

**Traversal:** a crossing tile's box is 42° wide. The tile is selected with the
view on the seam, and on each side of it alone, with and without `repeat`, but
not with the view across the world from it. A polar stereographic grid
(NSIDC's EPSG:3413 extent) gets a whole-world root box and is selected at every
longitude.

**Debug outline:** a crossing tile is outlined the short way, a whole-world
tile keeps its width, and an ordinary tile's corners are still joined by
straight lines.

**Geographic bounds:** UTM 60N gives 173.8° to 187.2°, the EPSG:4326 image
stored from -204° gives 156° to 198°, edge to edge stays -180° to 180°, and an
image away from the antimeridian is unchanged.

**Fixtures.** The five antimeridian fixtures in `fixtures/geotiff-test-data`
(EPSG:4326, rotated, UTM 60N, EPSG:3832, and edge to edge) run through the same
tileset and `RasterLayer` that `COGLayer` builds, with proj4:

- Every tile of every level converges in output mode, and meets the invariants
  above.
- Each image is selected on and beside the seam, with and without `repeat`.
- An EPSG:3832 edge block whose padding crosses 180°, though its image doesn't
  (#366), is drawn the short way.
- An EPSG:3031 tile with the pole at a corner is drawn as it would be without
  wrapping.

**By eye:** the fixtures in cog-basic, in Chrome, with the debug overlay.

## Scope

**In scope:** Web Mercator in output mode, for every layer built on
`RasterTileLayer` (`COGLayer`, `ZarrLayer`, `MultiCOGLayer`'s tiles).

**Out of scope:**

- Input mode, which a follow-up PR removes from the layers.
- The globe, and views in other projections.
- Tiles that contain a pole.
- `MosaicLayer` and `MultiCOGLayer` source bounds, covered by
  [#639](https://github.com/developmentseed/deck.gl-raster/pull/639).
- [#713](https://github.com/developmentseed/deck.gl-raster/issues/713): tiles
  centered on the equator never converge. That is unrelated to the seam, but
  whole-world tiles hit it.
- [#715](https://github.com/developmentseed/deck.gl-raster/issues/715): the
  geographic bounds of a rotated image are too small.
- An antimeridian scenario for the reprojection explainer. That is the next PR,
  and it replaces [#703](https://github.com/developmentseed/deck.gl-raster/pull/703).
