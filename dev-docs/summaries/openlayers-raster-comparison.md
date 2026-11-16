# OpenLayers raster comparison

**Date:** 2026-11-09 (written up 2026-11-16)
**Detailed version:** [`../reports/openlayers-raster-comparison.md`](../reports/openlayers-raster-comparison.md), with the research notes, scripts and results beside it.
**Builds on:** [`../specs/2026-10-13-output-pixel-error-design.md`](../specs/2026-10-13-output-pixel-error-design.md) and [`../lod-and-pixel-matching.md`](../lod-and-pixel-matching.md).

## The question

How does the raster support in deck.gl-raster compare to the raster rendering support in OpenLayers? How do the reprojection meshes compare? How is the usability of each? Are we better than their project? Anything we could learn from them? Follow-ups: why OpenLayers reads its reprojected tiles back to the CPU, whether the 0.125 px default is why we mesh slower, whether drawing through the mesh every frame is slow, how good PR [#759] is, whether OpenLayers is limited to uint8 and float32, whether refining past the finest level means changing meshes as the user zooms, and what handling non-finite points in the reprojector means.

## Direct answers

- **Are we better?** At rendering, yes. We mesh each source tile once and draw its texture through the mesh: one resampling, no readback, 16-bit data on the GPU, and pitch, globe and terrain. OpenLayers is ahead for 2D use: any projection as the map's view, JSON band-math expressions, pixel values, and more examples.
- **Why does OpenLayers read back to the CPU?** Not because its drawer is canvas-based; it draws with WebGL. It puts reprojection in the source: a reprojected tile is a `DataTile`, whose contract is pixels in CPU memory. It renders each tile in its own WebGL 1 context and calls `readPixels`, because WebGL can't share textures between contexts. The contract dates from a 2022 canvas-2D version; WebGL replaced the drawing in 2024.
- **How do the meshes compare?** On typical tiles they are identical (2-32 triangles). Our Delaunay refinement needs 19-36% fewer triangles for conformal sources (UTM, polar stereographic). OpenLayers' map-space quads need about half as many for big lat/lon tiles in Web Mercator. OpenLayers builds meshes 2-7x faster at our tolerance, because it makes about 1 proj4 call per triangle against our 8-11. Both are blind to error at the equator, where Mercator's y has an inflection.
- **Is 0.125 px why we're slower?** Partly. Error grows with the square of triangle size, so a 4x tighter tolerance costs about 4x the triangles and time. In device pixels our default is several times tighter than OpenLayers' 0.5 px. At equal tolerance we are still 1.2-3.4x slower per mesh: per-triangle cost, not the tolerance.
- **Is drawing through the mesh every frame slow?** No. A mesh adds only vertices, which cost the GPU nothing at our sizes. The per-frame cost is per draw call (about 50 us of deck.gl and luma.gl CPU time per tile, measured in October), and it doesn't depend on mesh size.
- **PR [#759]?** Merge it. Its meshes are bit-identical to `main` in every case measured, it halves proj4 calls, and it builds 1.05-1.6x faster: most on conformal meshes, least on large lat/lon ones, where bookkeeping dominates. Strengthen its test first: it compares two memoized runs, so it can't catch a memo bug. An OpenLayers-style string-keyed cache is slower than no cache.
- **Is OpenLayers limited to uint8 and float32?** Yes, as a hard limit. The `DataTile` contract allows only those, the context is WebGL 1, and there is no custom-shader hook. GeoTIFF's default stretches 16-bit data to 8 bits. Ours takes any texture format through a custom `getTileData` and shader module; only our defaults are narrower.
- **Would refining past the finest level change meshes as you zoom?** Something has to: a fixed mesh has a fixed error on the map. A 10 m UTM tile's 2-triangle mesh is about 5 CSS px off at zoom 18, where OpenLayers is 0.14 px off. Refining in place is cheap for high-resolution tiles and runs away on coarse global tiles. Virtual sub-tiles past the finest level, each meshed from a seed confined to its part of the tile, change no mesh and work for both.
- **Non-finite points?** Source points with no map position, such as corners outside Mollweide's ellipse or the poles in Web Mercator, either produce NaN, which our reprojector treats as zero error so it never splits there, or garbage, which produces stretched triangles. OpenLayers splits quads near such points and drops what stays invalid, so its tiles clip themselves. We handle it case by case with clamp seeds.

## What to take from OpenLayers, in order

1. **Merge [#759]**, with a test that every vertex's output position equals a fresh projection.
2. **A Delaunay test on map positions instead of UVs**, on a branch built on [#759]. The prototype cuts large lat/lon meshes by 25-78% and, with [#759], builds them 1.6-5.9x faster. But it folds tiles that cross the equator (7,395 folded triangles on one), so it needs a UV validity guard on flips and an equator fix first.
3. **Forced splits or more test points** for the equator blind spot ([#713]), as OpenLayers forces splits of quads wider than a quarter of the world.
4. **Error past the finest level:** check whether it shows against a vector overlay at zooms 18-20, then build virtual sub-tiles.
5. **Non-finite points inside the reprojector** ([#850], [#575]): treat invalid points as infinite error and drop triangles below a minimum size. Start from a failing Mollweide or Equal Earth test.
6. **Level of detail by true resolution** at the tile centre, as OpenLayers' `calculateSourceResolution` does ([#751]).

Not worth copying: the second resampling pass, the readback, 8-bit normalization by default, WebGL 1.

## Defects found in deck.gl-raster

- Measured: lat/lon tiles that cross the equator get zero-area and folded triangles at the default tolerance, and miss it (0.171 px against 0.125 on a 128° tile).
- Read in the code, not run: `FilterNoDataVal` tests only the red channel; `MultiCOGLayer` can't load LERC band files; `cieLabToRGB` shouldn't compile; the default pipeline draws every 3- and 4-band image as RGB(A); GDAL scale and offset are never applied.

## Decisions still open

- **[#759]:** take it out of draft with the stronger test.
- **The map-space Delaunay test:** start the branch on [#759].
- **The overzoom error:** whether it is visible enough to act on.
- **The `maxError` default:** whether to try 0.25 in an A/B.
- **The defects above:** whether to file them as issues.

[#575]: https://github.com/developmentseed/deck.gl-raster/issues/575
[#713]: https://github.com/developmentseed/deck.gl-raster/issues/713
[#751]: https://github.com/developmentseed/deck.gl-raster/issues/751
[#759]: https://github.com/developmentseed/deck.gl-raster/pull/759
[#850]: https://github.com/developmentseed/deck.gl-raster/issues/850
