# Mesh measurements: method, results and pitfalls

Notes behind the mesh sections of
[the report](../../openlayers-raster-comparison.md). The scripts are in
[`scripts/`](scripts/) and their full output in
[`scripts/results/`](scripts/results/).

- **Measured:** 2026-11-09; re-run with the committed scripts on 2026-11-16.
- **Machine:** Apple M2 Pro, macOS, Node 24.21.0, proj4 2.22.0.
- **Code:** deck.gl-raster
  [`a72d7a14`](https://github.com/developmentseed/deck.gl-raster/tree/a72d7a147717d0bf4ef7745ae1c887bcab6ae023)
  (`packages/raster-reproject/src/delatin.ts` is unchanged through `8c27dbee`,
  2026-11-16), PR [#759] at
  [`0f1eaac6`](https://github.com/developmentseed/deck.gl-raster/tree/0f1eaac68a00165775df8afbe7cc9f111cc3a794),
  OpenLayers
  [`e50554ba`](https://github.com/openlayers/openlayers/tree/e50554baf350ea5ab1c1db6e7aa530b29fc5681f).

## Method

**Images.** Every case is a north-up 512 x 512 px source image, given as CRS,
top-left corner and pixel size:

| Case | CRS | Extent |
|---|---|---|
| UTM 33N, 10 m | EPSG:32633 | 5 km square at 300000 E, 5000000 N (about 45°N) |
| UTM 33N, 160 m | EPSG:32633 | 82 km square, same corner |
| UTM 33N, 1280 m | EPSG:32633 | 655 km square at 166000 E, 5300000 N |
| EPSG:3413, 2 km | NSIDC polar stereographic north | 1024 km square at (-1200000, -2000000), about 64-72°N |
| EPSG:4326, 5° | lat/lon | 10-15°E, 40-45°N |
| EPSG:4326, 0-80N | lat/lon | 0-90°E, 0-80°N |
| EPSG:4326, 40-80N | lat/lon | 0-90°E, 40-80°N |
| EPSG:4326, 45-90N, clamped | lat/lon | 0-45°E, 45-90°N, meshed from a seed clamped at 85.0511°N as `RasterTileset2D` does |
| EPSG:4326, 128° | lat/lon, 0.25° pixels | 64°W-64°E, 48°S-80°N |
| [#713] | lat/lon | 0-90°E, 45°S-45°N |

**Our reprojector** runs with `_errorSpace: "output"`, as `RasterLayer` does,
and the image's `width + 1` and `height + 1`, as `RasterLayer` passes them. The
OpenLayers comparisons output EPSG:3857 metres. The variant benchmark outputs
deck.gl common space, as `RasterTileLayer` does. The error metric and the
Delaunay test are invariant under the uniform scale between the two, so the
meshes agree, except on the stalling equator tiles, where floating-point
differences change the counts by a few triangles.

**OpenLayers' `Triangulation`** runs in Node straight from `src/ol`.
`register(proj4)` registers the CRSs, and `addCoordinateTransforms` installs
the same proj4 converter our side uses, wrapped to count calls.

- Experiment A ("same job") swaps OpenLayers' roles: its target is our source
  rectangle and its source is EPSG:3857. Its threshold, in source units, is
  the tolerance times one output pixel in metres. So it meshes the same
  rectangle in the same direction as we do.
- Experiment B ("as it runs") meshes every 256 px EPSG:3857 tile at zoom z
  that overlaps the image's footprint, the way `ReprojDataTile` does. Each tile
  gets `calculateSourceExtentResolution` and a threshold of the tolerance times
  that resolution. z is the zoom where one screen pixel is about one source
  pixel at the image centre.

**True error** is measured inside each triangle, as the GPU draws it. The
script samples a barycentric grid in each triangle's UV (one step per 4 source
px, at least 6 per edge) and maps each point two ways: affinely to the
triangle's output vertices (where it's drawn) and through the exact
projection (where it belongs). The distance between the two is divided by the
error unit: one source pixel's size on the map at the seed's centre (the
reprojector's own unit), or one screen pixel at zoom z in experiment B.
"Folded" counts triangles whose UV orientation is opposite to the mesh's.
"Area over" is the share of the drawn area whose error exceeds the tolerance.
OpenLayers' experiment B meshes are measured from the screen side instead: 48 x
48 points per target tile, each mapped through the mesh to the texel it draws,
then forward to where that texel belongs.

**Timing** is the median of 5 runs (OpenLayers comparisons) or 11 interleaved
runs (variants), after a warm-up run. Sub-millisecond timings vary by 10-30%
between runs.

## Results

- [`openlayers-vs-ours.txt`](scripts/results/openlayers-vs-ours.txt):
  experiments A and B at 0.5 and 0.125 px.
- [`overzoom-error.txt`](scripts/results/overzoom-error.txt): absolute error of
  a 10 m UTM tile's mesh, read as CSS px at zooms 16, 18 and 20.
- [`reprojector-variants.txt`](scripts/results/reprojector-variants.txt): five
  variants on nine images at two tolerances: triangles, proj4 calls per
  triangle, time, true error, folded and zero-area triangles, duplicate
  vertices, and which meshes are bit-identical.
- [`overzoom-refine.txt`](scripts/results/overzoom-refine.txt): refining in
  place, one zoom level at a time, for a Sentinel-2-like tile and a coarse
  global tile.

Observations that aren't in the report:

- **[#759] is bit-identical to `main`**, and [#759] with the map-space test is
  bit-identical to the map-space test alone, in all 18 runs (9 images x 2
  tolerances). So is the coordinate cache.
- **[#759]'s gain shrinks as meshes grow:** 1.4-1.6x on conformal meshes up to
  1,200 triangles, 1.05-1.2x on lat/lon meshes of 3,000-9,000 triangles. On
  large meshes the heap and halfedge bookkeeping dominates, not proj4
  (0.2-0.35 us per call).
- **The coordinate cache is slower than no cache** (0.43-1.0x), even on the
  stalled [#713] tile, where 92% of calls are repeats. It halves the proj4 calls
  elsewhere, but building a string key costs more than the projection.
- **The runaway at +4 levels** on the 128° tile (`overzoom-refine.txt`): the
  last 100,000 vertices are all within 5° of the equator, and half of them are
  within 0.001 (in u) of the tile's left or right edge. About half of the 2
  million triangles are folded. Before the runaway, the left edge has
  vertices at 5.33°N and 5.58°S, so the sub-edge between them has its
  midpoint near the equator, where Mercator's y has an inflection and the
  midpoint shows almost no error. That fits the [#713] mechanism (a boundary
  edge never split, centroid splits piling up beside it) on a sub-edge. It
  wasn't traced further.
- **The 128° tile on `main` at 0.125** (`reprojector-variants.txt`): 530
  zero-area triangles, 6 folded and 6 duplicate vertices, and a true error of
  0.171 px against the 0.125 the reprojector reports. The worst triangle spans
  10.7°S to 12.4°N.

## Pitfalls

- **Locating grid points in the mesh is unreliable on degenerate meshes.** The
  first version of these scripts sampled a 257 x 257 grid over the image and
  found each point's triangle by a barycentric test. Zero-area and folded
  slivers passed that test for points outside them, and their wild
  interpolation produced spurious errors: 105 px for the [#713] tile (true:
  0.5-1.3 px) and 24.9 px for the 128° tile (true: 0.171 px). The 105 px
  figure was reported in the discussion on 2026-11-09 before this was found.
  Sampling inside each triangle avoids the problem, because every sample
  belongs to a triangle that is drawn.
- **The equator tiles stall chaotically.** Small floating-point differences,
  such as metres against common-space units, change which triangle stalls and
  the final error. Read their numbers as "stalls with zero-area and folded
  triangles, error about 0.5-1.3 px", not as exact values.
- **The overzoom OpenLayers level is computed, not observed.** `ReprojDataTile`
  stops at the target grid's maximum zoom, which
  `DataTileSource#getTileGridForProjection` derives from the source's finest
  resolution (z15 for 10 m with 256 px tiles). Beyond it, OpenLayers magnifies
  the reprojected raster.

[#713]: https://github.com/developmentseed/deck.gl-raster/issues/713
[#759]: https://github.com/developmentseed/deck.gl-raster/pull/759
