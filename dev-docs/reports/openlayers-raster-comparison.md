# Keep drawing through one mesh; borrow OpenLayers' map-space meshing

- **Date:** 2026-11-09 (research); 2026-11-16 (written up, measurements re-run)
- **Code read:** deck.gl-raster [`a72d7a14`][dgr] (0.10.0-beta.4), OpenLayers
  [`e50554ba`][ol] (10.11.1-dev, BSD-2-Clause)
- **Summary:** [`../summaries/openlayers-raster-comparison.md`](../summaries/openlayers-raster-comparison.md)
- **Research notes, scripts and results:**
  [`research-notes/openlayers-raster-comparison/`](research-notes/openlayers-raster-comparison/)

## The question

How does the raster support in deck.gl-raster compare to the raster rendering
support in OpenLayers? How do the reprojection meshes compare? How is the
usability of each? Are we better than their project? Anything we could learn
from them?

Follow-up questions from the same discussion: Does OpenLayers read its
reprojected tiles back to the CPU because it draws with canvas rather than
WebGL? Is our meshing slower because `maxError` defaults to 0.125 px? Is
drawing the source texture through the mesh every frame slow? How good is
[#759]? Is OpenLayers limited to uint8 and float32 data, given that ours takes
any type through custom shader modules? Would refining meshes past the finest
level mean changing them as the user zooms? What does handling non-finite
points inside the reprojector mean?

We render rasters better, and our design should stay. To reproject a GeoTIFF
or GeoZarr source, OpenLayers meshes each 256 px tile of the map's projection,
renders the source into that tile in a separate WebGL 1 context, and reads
the result back with `readPixels`, because a reprojected tile must be a
CPU-side `DataTile` like any other. Then it uploads that tile and draws it as
a quad. We mesh each source tile once and draw its texture through the mesh.
So we resample once, keep 16-bit data on the GPU, and never read back. On
typical tiles the two meshers produce the same 2-32 triangles. For conformal
sources such as UTM and polar stereographic, our Delaunay refinement needs
**19-36% fewer triangles**. For a large lat/lon tile in Web Mercator,
OpenLayers needs **about half as many** as it runs. It also builds meshes
**2-7x faster** at our tolerance, because it calls proj4 about once per
triangle against our 8-11. Two of its ideas are worth taking:

- **Shape triangles on the map instead of in the source grid.** A Delaunay
  test on map positions cuts lat/lon meshes by 25-78%, and with [#759] builds
  them **1.6-5.9x faster**. But it folds tiles that cross the equator until it
  gets a guard.
- **Stop error growing past the data's finest level.** One mesh per source
  tile leaves a 10 m UTM tile **about 5 CSS px off at zoom 18**; OpenLayers is
  0.14 px off.

OpenLayers is easier to use for 2D maps: any projection as the view, JSON
band-math expressions, and pixel values. We are ahead on 3D, data fidelity,
request handling, mosaics and multi-resolution band files. The measurements
also found a defect of ours: lat/lon tiles that cross the equator get
zero-area and folded triangles and miss their tolerance ([#713]).

## OpenLayers reprojects into new tiles on the CPU side; we draw the source through a mesh

OpenLayers draws GeoTIFF and GeoZarr with its `WebGLTile` layer. Each tile is
one textured quad, placed by a 2D affine transform with rotation but no
perspective ([`TileLayerBase.js:569-581`][ol-tile-transform]). When a source's
projection differs from the view's, `DataTileSource#getTile` returns a
`ReprojDataTile` ([`source/DataTile.js:322-337`][ol-get-tile]). For each 256 px
tile of a target grid in the view's projection, that tile does five things:

1. It triangulates the tile in the view's projection and maps the vertices
   into the source with the inverse transform
   ([`Triangulation.js`][ol-tri-test]).
2. It picks the source level by comparing the true resolution in both
   projections at the tile's centre
   ([`calculateSourceResolution`][ol-source-res]).
3. It loads the source tiles under the triangulation's source extent.
4. In a pooled offscreen WebGL 1 context
   ([`glreproj.js:69-89`][ol-gl-context]), it stitches those tiles into one
   texture and draws the triangles into a framebuffer, four bands at a time
   ([`reproj/DataTile.js:437-463`][ol-reproj-gl]).
5. It reads the framebuffer back with `readPixels`
   ([`reproj/DataTile.js:544-563`][ol-readpixels]) into a typed array, which
   becomes the tile's data ([`:568-580`][ol-reproj-data]).

The layer then uploads that array and draws it like any unprojected tile.

**The readback isn't because the drawer is canvas-based.** The tile renderer is
WebGL; the readback comes from where reprojection lives. OpenLayers makes a
reprojected tile a kind of `DataTile`, and a `DataTile` promises its consumers
pixels in CPU memory: a typed array or an image ([`DataTile.js:9-19`][ol-arraylike]).
The WebGL renderer uploads them, `layer.getData(pixel)` reads values from them,
and the CPU `Raster` source computes on them. Sources don't know the GL context
of the layers that draw them, since one source can feed layers in different
canvases. So reprojection runs in a context of its own, and WebGL can't share
textures between contexts. The array contract came first. `ReprojDataTile` was
added in 2022 using canvas 2D: it packed raw bytes three per pixel into RGB and
read them back with `getImageData` ([`dafa34e1`][ol-commit-2022]). In May 2024
the drawing moved to WebGL, to get float textures and interpolation
([`348ccbc3`][ol-commit-gl], [`280b7957`][ol-commit-switch]), and
`getImageData` became `readPixels`. Canvas 2D still reprojects image sources
such as XYZ and WMTS for the canvas tile layer, by clipping and calling
`drawImage` once per triangle ([`reproj.js:334-464`][ol-canvas-render]).

The design costs OpenLayers three things:

- Each pixel is resampled twice: into the reprojected tile, then onto the
  screen. A stitch pass comes first when several source tiles feed one target
  tile.
- Every target tile at every zoom level costs a GPU-to-CPU round trip.
- Data is limited to what `readPixels` can return into a `DataTile`: uint8 and
  float32.

**We** give each source tile (a COG tile or Zarr chunk) one `RasterLayer`
([`raster-tile-layer.ts:745-835`][dgr-render-sublayers]). It builds a
`RasterReprojector` mesh once ([`raster-layer.ts:229-328`][dgr-generate-mesh])
and draws the tile's texture through it in deck.gl's common space every frame.
There is one resampling and no readback, and 16-bit textures stay 16-bit.

**Drawing through the mesh every frame isn't slow.** Every WebGL map redraws
its visible tiles each frame while the view moves, OpenLayers included. The
mesh only adds vertices. A 2,000-triangle tile has about 1,000 vertices, and
100 such tiles are about 100,000 vertices per frame, which costs a GPU almost
nothing. The fragment work equals that of a quad covering the same area. What
does cost is the number of draw calls. October 2026 profiling measured about
**50 us of deck.gl and luma.gl CPU overhead per tile per frame**: 3.6 ms per
frame with 66 tiles in the naip-mosaic example. That cost doesn't depend on
mesh size, and nothing is drawn while the view is still. Cutting it means
fewer draw calls, through instancing or texture arrays. Since then,
[#874] removed `MeshTextureLayer`'s unused lighting modules, whose uniforms
deck.gl updated on every draw.

## The two meshers tie on typical tiles and split on distorted ones

| | OpenLayers `Triangulation` | deck.gl-raster `RasterReprojector` |
|---|---|---|
| What is meshed | each 256 px tile of the view's projection | each source tile, once |
| Projection direction | inverse: view to source | forward only: source to view |
| Refinement | halve an axis-aligned quad across its longer side, recursively ([`Triangulation.js:387-466`][ol-tri-test]) | greedy Delaunay insertion (Delatin): add the worst test point, then flip edges that fail the in-circle test in UV ([`delatin.ts:700-747`][dgr-legalize]) |
| Test points | 1 per quad: its centre, against the mean of the diagonal's ends | 4 per triangle: the centroid and the edge midpoints ([`delatin.ts:23-30`][dgr-sample-points]) |
| Tolerance | 0.5 px of the target tile ([`common.js:10`][ol-common]); fixed for GeoTIFF and GeoZarr, whose tiles never receive `errorThreshold` ([`source/Tile.js:113-115`][ol-tile-options]) | `maxError`, 0.125 output px: one source pixel's size on the map |
| Limits | depth 10, at most 2,048 triangles per tile ([`Triangulation.js:31-38`][ol-tri-max]): cost is bounded, error is not | 10,000 insertions ([`delatin.ts:294-314`][dgr-run]): error is bounded until the cap |
| Projection edges | inside the triangulation: quads with non-finite corners are split, then dropped or cut to one triangle ([`:352-385`][ol-tri-nonfinite], [`:476-494`][ol-tri-keep]); quads wider than a quarter of the world are always split ([`:40-48`][ol-tri-width]) | outside the reprojector: Web Mercator clamp seeds, `_wrapX` unwrapping and clipping |
| Drawn | into a new tile, drawn as a quad | the source texture through the mesh, every frame |
| Rebuilt | per target tile and zoom level | once per source tile |

The benchmark runs both triangulators in Node on the same 512 px source images
with the same proj4 converter, and measures the true error inside every drawn
triangle. Experiment A gives both the same job: mesh our source rectangle at
the same tolerance in output pixels. Experiment B runs each library as it
runs: OpenLayers meshes every Web Mercator tile that overlaps the image, at the
zoom where one screen pixel is about one source pixel. The method and its
pitfalls are in
[`mesh-measurements.md`](research-notes/openlayers-raster-comparison/mesh-measurements.md).

**Experiment A, same job, 0.125 px** (errors in output px, times in ms):

| Source image, 512 px | Ours: triangles | OL: triangles | Ours: ms | OL: ms | Ours: max error | OL: max error |
|---|---|---|---|---|---|---|
| UTM 33N, 10 m (5 km) | 2 | 2 | 0.03 | 0.02 | 0.103 | 0.103 |
| UTM 33N, 160 m (82 km) | 32 | 32 | 0.27 | 0.13 | 0.103 | 0.103 |
| UTM 33N, 1280 m (655 km) | **256** | 400 | 0.93 | 0.48 | 0.120 | 0.124 |
| EPSG:3413, 2 km (64-72°N) | **1,206** | 1,492 | 5.09 | 1.88 | 0.125 | 0.123 |
| EPSG:4326, 5° (40-45°N) | 98 | 64 | 0.39 | 0.07 | 0.120 | 0.104 |
| EPSG:4326, 0-80°N | 5,192 | 3,920 | **19.3** | 2.9 | 0.125 | **0.521** |
| EPSG:4326, 45°S-45°N ([#713]) | **19,988 (cap)** | 2 | **51** | 0.00 | **0.543** | **12.7** |

**Experiment B, as each library runs, 0.125 px** (errors in screen px):

| Source image, 512 px | Ours: triangles | ms | max error | OL: tiles | triangles | ms | max error |
|---|---|---|---|---|---|---|---|
| UTM 33N, 160 m | 32 | 0.10 | 0.076 | 9 | 60 | 0.22 | 0.085 |
| UTM 33N, 1280 m | **256** | 0.84 | 0.089 | 6 | 332 | 0.47 | 0.071 |
| EPSG:3413, 2 km | **1,206** | 5.00 | 0.125 | 9 | 1,600 | 1.54 | 0.108 |
| EPSG:4326, 5° | 98 | 0.32 | 0.124 | 9 | 100 | 0.29 | 0.069 |
| EPSG:4326, 0-80°N | 5,192 | **18.9** | 0.135 | 15 | **2,368** | 4.4 | 0.096 |

What the tables show:

- **Typical tiles tie.** A COG tile drawn at its own zoom looks like the 10 m
  and 160 m UTM rows: identical meshes of 2-32 triangles, built in under
  0.3 ms.
- **Conformal sources over large areas favour us.** Delaunay insertion puts
  points where the curvature is, so it needs 19-36% fewer triangles than
  bisection.
- **Lat/lon in Web Mercator favours OpenLayers.** Near 80°N, Web Mercator
  draws a lat/lon pixel about 5.8 times taller, relative to its width, than at
  the equator. OpenLayers meshes square tiles of the map, so in degrees its
  quads come out wide and short, which matches that distortion: 2,368
  triangles against our 5,192. Our in-circle test runs on UV
  coordinates and keeps triangles well shaped in the source grid, which wastes
  splits along the parallels.
- **OpenLayers' single test point misses error.** Given our whole rectangle at
  0.125 px, it ends 0.52 px off, with 7.8% of the area over the tolerance
  (0.22% at 0.5 px). As it runs, its tiles are smaller and it holds.
- **We pay more per triangle.** We make 8-11 proj4 calls per triangle against
  OpenLayers' 0.9-1.5, and spend 3.6-4.2 us per triangle against 0.75-1.3 us.
  At OpenLayers' own 0.5 px we are still 1.2-3.4x slower per mesh, on meshes
  of more than 50 triangles.
- **Both share a blind spot at the equator.** Mercator's y has an inflection
  there, so a test point on the equator sees no error.
  - OpenLayers' one test point at the centre of the [#713] tile gives 2
    triangles that are 12.7 px off. On real maps it is guarded twice: it
    always splits quads wider than a quarter of the world
    ([`Triangulation.js:40-48`][ol-tri-width]), and its tile grid splits at
    the equator anyway.
  - Our mesh of that tile hits the 10,000-insertion cap in 51 ms, most of its
    19,988 triangles have zero area, and its true error stays at 0.5-1.3 px
    (measuring it needs care: see
    [Pitfalls](research-notes/openlayers-raster-comparison/mesh-measurements.md#pitfalls)).

**The 0.125 px default explains part of our cost, not all of it.** Error grows
with the square of triangle size, so a 4x tighter tolerance costs about 4x the
triangles and time:

- EPSG:4326 0-80°N goes from 1,134 triangles and 4.0 ms at 0.5 px to 5,192
  and 19.3 ms at 0.125.
- EPSG:3413 goes from 302 triangles and 1.3 ms to 1,206 and 5.1 ms.

In screen terms our default is much tighter than OpenLayers'. `maxError` is
measured in source pixels. At the level the traversal selects, one source pixel
is drawn at 0.5-1 device px ([`lod-and-pixel-matching.md`](../lod-and-pixel-matching.md);
[#751] finds the selection is often a level coarser). So 0.125 is about
0.06-0.125 device px. OpenLayers' 0.5 px is half a pixel of its tile grid, one
device px on a 2x display. Since `maxError` is a prop, an A/B at 0.25 is cheap.
At equal tolerance, the rest of our cost is per triangle: proj4 calls, plus the
heap and halfedge bookkeeping.

## Our mesh error grows past the data's finest level; OpenLayers' doesn't

`maxError` is relative to the source tile's own pixels. A tile's mesh therefore
has a fixed error in map units, and zooming past the data's finest level
magnifies it. OpenLayers re-meshes smaller target tiles at each zoom level,
down to one level past the source's finest resolution
([`source/DataTile.js:455-481`][ol-target-grid]). Beyond that it magnifies the
reprojected raster, whose mesh error stays small.

| 10 m UTM tile (5 km) at 45°N | Triangles | Max error | CSS px at zoom 16 | zoom 18 | zoom 20 |
|---|---|---|---|---|---|
| Ours: one mesh for the tile, 0.125 px | 2 | 1.46 Mercator m | 1.2 | **4.9** | **19.5** |
| OpenLayers: 48 target tiles at its finest level | 96 | 0.04 Mercator m | 0.03 | 0.14 | 0.55 |

Zooms are deck.gl and MapLibre zooms (512 px tiles). Something has to change
as the user zooms in, because a fixed mesh has a fixed error on the map. There
are two ways to do it:

- **Refine in place.** `RasterReprojector` keeps its state, so calling `run()`
  again with half the tolerance for each extra zoom level continues from the
  existing mesh. The only change on the GPU is a buffer update when crossing a
  level.
  - For high-resolution data this is cheap. The 5 km Sentinel-2-like tile goes
    from 2 to 128 triangles over 6 extra levels, each step under 1.2 ms.
  - For coarse data it breaks down. A 128° tile of 0.25° data (48°S-80°N) goes
    from 8,940 triangles to 61,075 by +3 levels. At +4 it stops converging:
    after a million refinement steps (6 s) it has 2 million triangles, about
    half of them folded, and all its last 100,000 vertices are within 5° of
    the equator. This looks like the [#713] mechanism on a sub-edge of the
    tile's side.
- **Virtual sub-tiles past the finest level.** This is OpenLayers' approach in
  our terms. Split the finest tile into sub-tiles that reuse its texture, and
  mesh each one from a seed confined to its UV sub-rectangle;
  `triangulateRectangle(u0, v0, u1, v1)` already builds such seeds. No mesh
  ever changes: new small meshes appear as you zoom, as tiles do today, and
  only the visible part is meshed. This needs traversal past `maxZ` and
  texture sharing between tiles.

Before building either, check whether a 5 px error at zoom 18 is visible
against a vector overlay.

## An edge memo halves the proj4 calls; a coordinate cache doesn't

About half of our projections repeat. Each edge midpoint is measured by both
triangles on the edge, and again whenever a flip rebuilds them. OpenLayers
caches its transforms by a string key of the coordinate
([`Triangulation.js:100-111`][ol-tri-cache]). The same cache in front of our
`forwardReproject` halves the proj4 calls but makes builds **0.4-1.0x as
fast**, because building the key costs more than a proj4 call (0.2-0.35 us).

[#759] memoizes only the edge midpoints, keyed by the edge's two vertex
indices in nested `Map`s, and clears the memo when `run()` finishes. Its
meshes were **bit-identical to `main`** in all 18 runs here (9 images x 2
tolerances). That holds by construction: a midpoint's UV comes out identical
whichever triangle computes it, and vertices are never removed.

| 512 px tile, 0.125 px | `main` ms | [#759] ms | Speed-up | proj4 calls per triangle |
|---|---|---|---|---|
| UTM 33N, 1280 m | 0.89 | 0.57 | **1.55x** | 8.0 -> 4.1 |
| EPSG:3413, 2 km | 5.04 | 3.16 | **1.60x** | 8.0 -> 4.1 |
| EPSG:4326, 0-80°N | 19.7 | 17.2 | **1.15x** | 10.9 -> 5.5 |
| EPSG:4326, 45-90°N, clamped ([#759]'s own tile) | 32.9 | 31.3 | 1.05x | 11.0 -> 5.5 |
| [#713] tile (hits the cap) | 61.2 | 47.0 | **1.30x** | 8.5 -> 4.3 |

On large lat/lon meshes the gain is small, because the heap and halfedge
bookkeeping, not proj4, dominates there. The PR is worth merging. One review
note: its determinism test compares two memoized runs, so it can't catch a memo
bug. A stronger test asserts, after `run()`, that every vertex's
`exactOutputPositions` equals a fresh projection of its UV. That catches a
wrong-edge lookup as soon as a memoized midpoint becomes a vertex.

## A Delaunay test on map positions shrinks lat/lon meshes, but folds tiles that cross the equator

The prototype runs `_legalize`'s in-circle test on the vertices' output
positions instead of their UVs, negating y when the map mirrors the UV
orientation (Web Mercator's y grows north, v grows south). It is a text patch
of `delatin.ts`, `withMapSpaceDelaunayTest` in
[`scripts/common.mjs`](research-notes/openlayers-raster-comparison/scripts/common.mjs).

| 512 px tile, 0.125 px | `main`: triangles, ms | Map-space: triangles, ms | Map-space + [#759]: ms (vs `main`) |
|---|---|---|---|
| UTM 33N, 1280 m | 256, 0.89 | 256, 1.03 | 0.73 (1.22x) |
| EPSG:3413, 2 km | 1,206, 5.04 | 1,208, 6.30 | 4.10 (1.23x) |
| EPSG:4326, 5° (40-45°N) | 98, 0.32 | **70**, 0.23 | 0.17 (**1.89x**) |
| EPSG:4326, 0-80°N | 5,192, 19.7 | **2,336**, 9.0 | 6.6 (**2.98x**) |
| EPSG:4326, 40-80°N | 2,898, 10.1 | **2,164**, 7.9 | 6.2 (**1.63x**) |
| EPSG:4326, 45-90°N, clamped | 8,852, 32.9 | **1,964**, 7.1 | 5.6 (**5.86x**) |
| EPSG:4326, 0.25°, 128° (48°S-80°N) | 8,938, 33.3 | **19,910 (cap), 7,395 folded** | 42.7 (**0.78x**) |
| [#713] tile | 19,985 (cap), 61.2 | 19,999 (cap), **4,389 folded, 15.8 px off** | 44.0 (1.39x) |

- **Lat/lon tiles off the equator:** 25-78% fewer triangles at the same true
  error, and 1.6-5.9x faster with [#759]. That is the global EPSG:4326 mesh cost
  the October profiling found. On the 0-80°N tile, one mesh of 2,336 triangles
  now matches OpenLayers' 2,368 across 15 tiles.
- **Conformal sources:** the same mesh, 6-20% slower alone, and 1.1-1.2x
  faster with [#759]. More flips mean more triangles re-measured: 9.5-9.9 proj4
  calls per triangle against `main`'s 8.0.
- **Tiles across the equator break.**
  - At 0.5 px the 128° tile's true error is 0.73 px.
  - At 0.125 px refinement hits the cap with 7,395 folded triangles.
  - The [#713] tile goes from 1.3 to 15.8 px off.

There are two causes. A flip that is right on the map can be invalid in UV
when the quad isn't convex there, which folds the mesh. And triangles that are
well shaped on the map are long in UV, so 4 test points miss more of their
error, worst where the equator zeroes them.

Before this ships it needs three things:

1. **A UV validity guard on each flip:** flip only when the quad is convex in
   UV.
2. **A fix for the equator blind spot it shares with `main`:** more test points
   along edges, or forced splits by size, as OpenLayers does.
3. **A fix for the cost on conformal tiles, if the guard doesn't remove it.**
   One idea, untested: run the test in UV transformed by the Jacobian at the
   tile centre. For a conformal map that is a rotation and scale, which leaves
   the Delaunay mesh unchanged; it may not capture lat/lon anisotropy across a
   tall tile.

## Points with no position on the map: OpenLayers clips them inside the triangulation

Our mesh needs a map position for every vertex and test point, and some source
points have none:

- a Mollweide or Equal Earth tile's corners outside the projection's ellipse;
- Web Mercator at the poles;
- with deck.gl v10 custom views, the far hemisphere of an orthographic view.

Today what happens depends on what proj4 returns:

- **NaN.** The error at that point comes out NaN, and `err > maxError` is
  false for NaN ([`delatin.ts:453-460`][dgr-nan]). So the reprojector treats
  those triangles as exact and never splits them, and GPUs generally don't
  draw a triangle with a NaN vertex. With the 2-triangle seed, one bad corner
  can blank half a tile, valid pixels included.
- **Finite garbage**, as from Mollweide's inverse, which wraps longitude or
  clamps to a pole. The errors come out huge, refinement chases the jump, and
  the result is stretched triangles ([#850]).

Our fixes are per case: the 85.05° clamp seed
([`createInitialWebMercatorTriangulation`][dgr-clamp-seed], north-up
geographic tiles only; [#575] covers the rest) and
[`makeClampedForwardTo3857`][dgr-clamped-forward].

OpenLayers handles it generically inside its triangulation
([`Triangulation.js:352-385`][ol-tri-nonfinite], [`:476-494`][ol-tri-keep]).
A quad with a non-finite corner is split down to the depth limit. There, a
quad with one bad corner keeps the triangle of its other three, and anything
worse is dropped. The drawn area follows the edge of the valid region to
within the smallest quad, 8 px.

Our version would treat an invalid vertex or test point as infinite error, so
that refinement crowds along the boundary of the valid region. Below a minimum
size, such as one output pixel, it would drop the triangle instead of splitting
it. The clamp seeds become a special case, and bounded projections and
orthographic views clip themselves. There are two catches:

- "Invalid" must include finite garbage. That needs a validity check such as
  `inverse(forward(p)) ~ p`, which costs extra projections.
- The boundary costs triangles in proportion to its length in pixels.

The place to start is a failing test: an Equal Earth or Mollweide tile half
outside the ellipse.

## Usability: OpenLayers is easier in 2D; we cover 3D and more data

| | OpenLayers 10.11 | deck.gl-raster 0.10 |
|---|---|---|
| Show a COG | `new WebGLTile({source: new GeoTIFF({sources: [{url}]})})`, view from `source.getView()` | `new COGLayer({id, source: url})` |
| Formats | GeoTIFF and COG through geotiff.js, external `.ovr` files, several files as the bands of one image; GeoZarr (experimental: Zarr v2 and v3, dimensions, time); any `DataTile` loader | COG through our own reader (LZW, Deflate, ZSTD, LERC, JPEG, WebP; decoding in workers; merged range reads); multi-file scenes, at different resolutions; mosaics (STAC, GDAL VRT); GeoZarr, where the app writes `getTileData` and `renderTile`; any tile grid, including OGC TileMatrixSets |
| CRS from the data | EPSG GeoKeys; 3857, 4326 and UTM built in; others through `register(proj4)` and `loadMissingProjection` (spatialreference.org); user-defined GeoKeys not parsed | EPSG codes, user-defined GeoKeys, WKT and PROJJSON; unknown EPSG codes from epsg.io ([`registry.ts:68-77`][dgr-epsg-io]) or offline from `@developmentseed/epsg` |
| Map projection | any registered CRS, with basemaps and vectors reprojected too | Web Mercator; a preliminary globe (a fixed 32 x 32 grid per tile, [`raster-layer.ts:239-262`][dgr-globe-hack]); custom projections only in an experimental example until deck.gl v10 |
| 3D | none: rotation only | pitch, globe, terrain draping, MapLibre interleaving |
| Data on the GPU | uint8 (read as 0-1) or float32, WebGL 1 ([`webgl.js:87`][ol-webgl1], [`TileTexture.js:48-67`][ol-upload]); GeoTIFF defaults to 8 bits stretched by min and max ([`GeoTIFF.js:1109-1115`][ol-geotiff-normalize]) | uint8 and uint16 at full precision (read as 0-1); other types as raw float32 in `MultiCOGLayer`; any luma.gl format through a custom `getTileData` and shader module |
| Band math and colour | JSON expressions compiled to GLSL (`band`, `interpolate`, `palette`, `case`, `match`, variables); `updateStyleVariables` changes values without recompiling ([`WebGLTile.js:649-652`][ol-style-vars]) | GLSL shader modules composed into a pipeline; changing module props doesn't recompile either; 107 named colormaps |
| Pixel values | `layer.getData(pixel)`: the stored values, so 8-bit for a default GeoTIFF | none |
| CPU raster operations | the `Raster` source, in workers | none |
| Cancelling loads | GeoTIFF tiles abort only when disposed; GeoZarr loads can't be aborted | COG tile loads abort when tiles leave the view; Zarr loads don't |
| Examples and docs | about 50 raster examples; API docs | 21 examples; API docs and one guide; bundler notes for Vite only |

**OpenLayers' data types are a hard limit.** Its tile data contract is
`Uint8Array | Uint8ClampedArray | Float32Array | DataView`
([`DataTile.js:9-19`][ol-arraylike]). Tiles upload as `UNSIGNED_BYTE` or
`FLOAT` into a WebGL 1 context, which has no 16-bit or integer texture formats
at all. Shaders are generated only from `style`; there is no hook for custom
GLSL. In practice 16-bit data becomes float32, which is exact but doubles the
memory (the `numpytile` example converts by hand), or 8-bit, which is lossy and
GeoTIFF's default. int32, uint32 and float64 lose precision as float32.

**Ours is open.** `getTileData` can upload any luma.gl texture format, and a
custom module can read it with `usampler2D` or `isampler2D`, as the land-cover
example does with `r8uint`. Our limits are only in the defaults. `COGLayer`'s
inferred pipeline handles unsigned integers only
([`render-pipeline.ts:85-94`][dgr-pipeline-uint]), and `CreateTexture` and
`CompositeBands` use float samplers ([#852]).

**Styling is the clearest usability gap.** NDVI with a colour ramp is one JSON
expression in OpenLayers. Here it is a GLSL module, and colormaps need the
sprite fetched and turned into a texture once the device exists. A declarative
layer that compiles to our modules would close the gap; that is being explored
separately.

## Where each is ahead

**We are ahead on:**

- Rendering fidelity: one resampling, no readback, 16-bit data on the GPU.
- 3D: pitch, globe and terrain.
- Request handling: merged range reads, a shared byte cache, and aborts for
  tiles that leave the view.
- Mosaics, scenes stored as several band files, and arbitrary tile grids.
- Mesh efficiency for conformal sources.

**OpenLayers is ahead on:**

- Any projection as the map's view. This is its biggest structural advantage,
  and the gap deck.gl v10's custom views are meant to close.
- Declarative styling, pixel values and CPU raster operations.
- Robustness at projection edges.
- Mesh build speed, and lat/lon meshes in Web Mercator.
- The breadth of its examples and docs.

## What to take from OpenLayers

In order of value against effort:

1. **Merge [#759]**, with the stronger test above. It isn't from OpenLayers,
   but the comparison measured it.
2. **The map-space Delaunay test**, on a branch built on [#759], with the UV
   flip guard and an equator fix, measured with
   [`reprojector-variants.mjs`](research-notes/openlayers-raster-comparison/scripts/reprojector-variants.mjs).
   It is the largest mesh win available for global lat/lon data.
3. **Forced splits or more test points** for the equator blind spot, which
   OpenLayers guards with its quarter-world rule ([#713]). The same
   size-based rule is one answer to globe faceting ([#566]).
4. **Error past the finest level:** check whether it is visible, then build
   virtual sub-tiles.
5. **Non-finite points inside the reprojector** ([#850], [#575]), starting
   from a failing Mollweide or Equal Earth test.
6. **Level of detail by true resolution.** `calculateSourceResolution`
   compares the true resolution in both projections at a tile's centre. That
   is close to the common-space metric [#751] recommends, and our
   [`_pixelSizeAt`][dgr-pixel-size] already computes the source side.

Not worth copying: the second resampling pass, the readback, 8-bit
normalization as a default, and WebGL 1.

## Defects found in deck.gl-raster

**Measured** ([`reprojector-variants.txt`](research-notes/openlayers-raster-comparison/scripts/results/reprojector-variants.txt),
[`overzoom-refine.txt`](research-notes/openlayers-raster-comparison/scripts/results/overzoom-refine.txt)):

- **Lat/lon tiles that cross the equator get degenerate meshes at the default
  tolerance.** Of the 8,938 triangles in the 128° tile of 0.25° data, 530
  have zero area and 6 are folded, and 6 vertices are duplicates. Its true
  error is 0.171 px against the 0.125 the reprojector reports; the worst
  triangle spans 10.7°S-12.4°N. It looks like the [#713] mechanism, on a tile
  that does converge.

**Read, not run:**

- `FilterNoDataVal` tests only the red channel
  ([`filter-nodata.ts:31`][dgr-nodata]). An RGB pixel whose red value equals
  nodata is dropped, whatever its other bands.
- `MultiCOGLayer` throws on band-separate tiles
  ([`multi-cog-layer.ts:825-827`][dgr-multicog-throw]), and the LERC decoder
  always returns them ([`lerc.ts:54`][dgr-lerc]). LERC-compressed band files
  likely can't load there.
- `cieLabToRGB` passes a `vec4` to a `vec3` parameter
  ([`cielab.ts:57`][dgr-cielab]), which shouldn't compile.
- The default pipeline draws every 3- and 4-band image as RGB(A) before it
  checks the photometric interpretation
  ([`render-pipeline.ts:307-310`][dgr-pipeline-rgb]). So the CMYK and CIELab
  modules are never reached, and a 4-band image that isn't RGB keeps its
  fourth band as alpha ([`render-pipeline.ts:271-294`][dgr-pipeline-alpha]).
- GDAL scale and offset are parsed ([`geotiff.ts:440-451`][dgr-scales]) but
  never applied.

## Since 2026-11-09

- deck.gl published `10.0.0-alpha.1`. [#882] moved the custom-projection
  example's stand-in to its crs-based `_CustomProjectionView`; the example
  still runs on deck.gl 9.4.
- [#874] removed `MeshTextureLayer`'s unused lighting modules.
- `delatin.ts` is unchanged, so every mesh result above holds for `main` at
  `8c27dbee`. [#759] is still a draft.

## Reproducing

The scripts, their README and their output are in
[`research-notes/openlayers-raster-comparison/scripts/`](research-notes/openlayers-raster-comparison/scripts/).
The two feature surveys behind the usability section are
[`openlayers-raster.md`](research-notes/openlayers-raster-comparison/openlayers-raster.md)
and
[`deckgl-raster.md`](research-notes/openlayers-raster-comparison/deckgl-raster.md).
Both cite file and line at the commits above.

[dgr]: https://github.com/developmentseed/deck.gl-raster/tree/a72d7a147717d0bf4ef7745ae1c887bcab6ae023
[ol]: https://github.com/openlayers/openlayers/tree/e50554baf350ea5ab1c1db6e7aa530b29fc5681f
[#566]: https://github.com/developmentseed/deck.gl-raster/issues/566
[#575]: https://github.com/developmentseed/deck.gl-raster/issues/575
[#713]: https://github.com/developmentseed/deck.gl-raster/issues/713
[#751]: https://github.com/developmentseed/deck.gl-raster/issues/751
[#759]: https://github.com/developmentseed/deck.gl-raster/pull/759
[#850]: https://github.com/developmentseed/deck.gl-raster/issues/850
[#852]: https://github.com/developmentseed/deck.gl-raster/issues/852
[#874]: https://github.com/developmentseed/deck.gl-raster/pull/874
[#882]: https://github.com/developmentseed/deck.gl-raster/pull/882
[ol-tile-transform]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/renderer/webgl/TileLayerBase.js#L569-L581
[ol-get-tile]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/source/DataTile.js#L322-L337
[ol-target-grid]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/source/DataTile.js#L455-L481
[ol-tile-options]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/source/Tile.js#L113-L115
[ol-tri-max]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj/Triangulation.js#L31-L38
[ol-tri-width]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj/Triangulation.js#L40-L48
[ol-tri-cache]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj/Triangulation.js#L100-L111
[ol-tri-nonfinite]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj/Triangulation.js#L352-L385
[ol-tri-test]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj/Triangulation.js#L387-L466
[ol-tri-keep]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj/Triangulation.js#L476-L494
[ol-source-res]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj.js#L107-L146
[ol-canvas-render]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj.js#L334-L464
[ol-common]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj/common.js#L10
[ol-reproj-gl]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj/DataTile.js#L437-L463
[ol-readpixels]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj/DataTile.js#L544-L563
[ol-reproj-data]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj/DataTile.js#L568-L580
[ol-gl-context]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/reproj/glreproj.js#L69-L89
[ol-arraylike]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/DataTile.js#L9-L19
[ol-upload]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/webgl/TileTexture.js#L48-L67
[ol-webgl1]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/webgl.js#L87
[ol-style-vars]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/layer/WebGLTile.js#L649-L652
[ol-geotiff-normalize]: https://github.com/openlayers/openlayers/blob/e50554baf350ea5ab1c1db6e7aa530b29fc5681f/src/ol/source/GeoTIFF.js#L1109-L1115
[ol-commit-2022]: https://github.com/openlayers/openlayers/commit/dafa34e1ca27679381e3b7270fe9cf9042949eaf
[ol-commit-gl]: https://github.com/openlayers/openlayers/commit/348ccbc3d584b3386d164087a3f6625d3cb174fe
[ol-commit-switch]: https://github.com/openlayers/openlayers/commit/280b795782dd5a6b8d544cd437f6d4ed83e55b13
[dgr-sample-points]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/raster-reproject/src/delatin.ts#L23-L30
[dgr-run]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/raster-reproject/src/delatin.ts#L294-L314
[dgr-nan]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/raster-reproject/src/delatin.ts#L453-L460
[dgr-pixel-size]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/raster-reproject/src/delatin.ts#L626-L651
[dgr-legalize]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/raster-reproject/src/delatin.ts#L700-L747
[dgr-generate-mesh]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/deck.gl-raster/src/raster-layer.ts#L229-L328
[dgr-globe-hack]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/deck.gl-raster/src/raster-layer.ts#L239-L262
[dgr-render-sublayers]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/deck.gl-raster/src/raster-tile-layer/raster-tile-layer.ts#L745-L835
[dgr-clamp-seed]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/deck.gl-raster/src/raster-tileset/web-mercator-clamp.ts#L39
[dgr-clamped-forward]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/proj/src/web-mercator.ts#L39-L55
[dgr-epsg-io]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/proj/src/registry.ts#L68-L77
[dgr-nodata]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/deck.gl-raster/src/gpu-modules/filter-nodata.ts#L31
[dgr-cielab]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/deck.gl-raster/src/gpu-modules/color/cielab.ts#L57
[dgr-multicog-throw]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/deck.gl-geotiff/src/multi-cog-layer.ts#L825-L827
[dgr-lerc]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/geotiff/src/codecs/lerc.ts#L54
[dgr-pipeline-uint]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts#L85-L94
[dgr-pipeline-alpha]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts#L271-L294
[dgr-pipeline-rgb]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts#L307-L310
[dgr-scales]: https://github.com/developmentseed/deck.gl-raster/blob/a72d7a147717d0bf4ef7745ae1c887bcab6ae023/packages/geotiff/src/geotiff.ts#L440-L451
