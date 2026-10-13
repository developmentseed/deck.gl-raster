# Target-space error metric for the reprojector

- **Date:** 2026-10-13
- **Issues:** related to [#673](https://github.com/developmentseed/deck.gl-raster/pull/673) (antimeridian), [#566](https://github.com/developmentseed/deck.gl-raster/issues/566) (globe faceting), [#694](https://github.com/developmentseed/deck.gl-raster/pull/694) (custom projections)
- **Status:** Design, awaiting review

## Problem

`RasterReprojector` refines a triangle mesh until every triangle's error is
below a tolerance (`maxError`, default 0.125). Today that error is measured in
**source pixels**, through the inverse projection. This mirrors gdalwarp's
approximate transformer, but our output differs from gdalwarp's in ways that
make a source-pixel tolerance give uneven accuracy on screen, and the inverse
projection causes failures of its own. Several pending designs depend on how
error is measured: antimeridian crossing (#673), the globe (#566) and arbitrary
view projections (deck.gl v10). This spec adds an opt-in **target-space** metric
and the tools to compare the two side by side, so we can decide the default.

### How error is measured today

Each triangle is tested at a few points: currently its centroid and the
midpoint of each edge. For a test point P:

- the GPU draws P at **G**, the blend of the triangle's corner positions by
  P's barycentric weights;
- the **source metric** maps G back into the image (`inverseReproject`, then
  `inverseTransform`) and reports the distance, in source pixels, between P and
  that point. In words: the data pixel that shows up where P is drawn is this
  many pixels away from P.

gdalwarp does the same thing. To fill an output grid it maps each output pixel
back to a source location and resamples there ("from a row and column in the
output dataset to a row and column in the source dataset"), approximates that
output → source mapping linearly along scanlines, and bounds the error "in
source dataset pixels" (`-et`, default 0.125). The GPU also maps output →
source: it interpolates texture coordinates linearly across each triangle. So
today's metric is the faithful analog of `-et`.

### Where the analogy breaks

- **Resolution.** gdalwarp's output grid has one resolution, usually chosen to
  match the source. Ours is the screen at any zoom. Tile selection keeps a
  tile's pixels at ½ to 1 device pixel (see
  [`lod-and-pixel-matching.md`](../lod-and-pixel-matching.md)), but a source
  pixel's size on the map changes across a tile and differs between x and y.
  An EPSG:4326 pixel in Web Mercator is square at the equator and 11.5× taller
  than wide at 85°N; in polar stereographic, a square-degree pixel at 80°N is
  about 6× taller than wide.
- **Two sides of one approximation.** Both metrics measure how far the GPU's
  piecewise-linear mapping is from the exact one: the source metric as the
  wrong data pixel at a fixed screen spot, the target metric as the wrong screen
  spot for a fixed data pixel. They differ by the local stretch: the error on
  the map ≈ the pixel's size on the map at that spot × the error in source
  pixels. A fixed source-pixel tolerance is therefore too strict where pixels
  are small on the map (wasted triangles) and too loose where they are big
  (visible error).
- **The inverse.** proj4 returns longitudes in (−180°, 180°], so a geographic
  source whose longitudes run past ±180° needs special handling (#673 adds a
  two-branch inverse that relies on proj4 passing EPSG:4326 longitudes through
  unchanged, which it does not do for datum-shifted geographic CRSs). A
  geographic band spanning all longitudes has left and right edges on the same
  meridian, which the inverse cannot tell apart. Some inverses are iterative
  (Equal Earth) or undefined (orthographic past the horizon).
- **The globe.** The GPU draws a flat triangle between three points on the
  sphere, so interior points sit below the surface (the sag is about R·θ²/8
  for a triangle spanning θ: 24 km at 10°, 220 km at 30°). To use the inverse,
  the drawn point must first be pushed back onto the sphere, which discards
  exactly the sag. This is why the globe path uses a uniform grid (#566).

### Measurements

From throwaway probes: the library's reprojector with only the metric
swapped. Target-mode errors are in units of one source pixel's size on the map
at the tile center (defined below), so both modes' tolerances mean "1/8 of a
pixel" at the zoom the tile is drawn at. "Worst error on the map" uses the same
unit.

| Case | Source metric | Target metric |
|---|---|---|
| NLCD (Albers → Web Mercator), 0.125 px | 6,001 triangles; worst error on the map 0.147 | 6,563 triangles |
| NLCD, 4 px | 194 triangles | 160 triangles |
| EPSG:4326 tile 60–85°N → Web Mercator, 0.125 px | 2,394 triangles; worst error on the map 0.54 | 5,602 triangles |
| EPSG:4326 band 30–85°N (±179.9°) → polar stereographic, 4 px | 1,100 triangles, 38% of vertices north of 70°N | 980 triangles, 13% north of 70°N |
| EPSG:4326 band 70–88°N, all longitudes → polar stereographic | never converges (the inverse confuses the two edges) | 10,524 triangles |
| EPSG:3832 world tile reaching −87° (rows squashed by the ±85.05° clamp) | stuck at 32 px | 360 triangles |
| UTM 60N tile across 180°, with inverse functions that throw | needs the inverse | 40 triangles; inverse never called |

The metrics mainly move *where* triangles go. Their totals stay close when the
parts of a tile that need refinement sit on both sides of the center (the two
rulers agree at the center and err in opposite directions away from it), and
diverge when they sit on one side (the 60–85°N tile, where Web Mercator bends
hardest near 85°N, exactly where pixels are biggest on the map).

## Goals

- An opt-in target-space mode in `RasterReprojector`, with `maxError` keeping
  its meaning: a number of pixels.
- Compare the two modes side by side on real data (in two examples) and in the
  reprojection explainer, including a scenario where they differ strongly.
- Gather the evidence to decide which mode should be the default.

## Non-goals

Each of these is a separate change after this one:

- Per-tile `metersPerPixel` in tile selection (today one value per level).
- Reworking the antimeridian handling (#673) on top of the target metric.
- Measuring in 3D for the globe.
- Making the inverse functions optional in `ReprojectionFns`.
- The other scenarios from the explainer scenario brainstorm (World → Equal
  Earth, Americas → orthographic, a Sentinel-2 tile → Web Mercator).
- Guarding the reprojector against zero-area triangles (found while reviewing
  #673: a tile containing a pole can recurse in edge flipping until the stack
  overflows).

## Design

### 1. `RasterReprojector`: the `errorSpace` option

```ts
new RasterReprojector(reprojectors, width, height, {
  initialTriangulation,
  errorSpace: "target", // "source" (default) | "target"
});
```

`errorSpace` defaults to `"source"`, so nothing changes unless a caller opts in.
The option's docstring defines both modes and marks `"target"` experimental.

**Pixel size.** In target mode, the constructor measures one source pixel's
size on the map once, before the first triangles are measured:

1. Take the center of the initial triangulation's UV bounds: the tile center
   by default, or the center of a smaller seed such as the Web Mercator pole
   clamp's.
2. Convert it to pixel coordinates the way the reprojector does
   (`u · (width − 1)`, `v · (height − 1)`), and project that point, the point
   one pixel to the right, and the point one pixel down
   (`forwardTransform`, then `forwardReproject`).
3. The pixel size is the geometric mean of the two projected step lengths, the
   same way `metersPerPixel` combines a pixel's two edges.
4. If the result is not a finite positive number, throw an error that names the
   mode, the UV center, the image size and the value. (Target mode is
   experimental; failing loudly helps find such cases.)

**Error.** For each test point, with P its pixel coordinates and G its blended
GPU position: error = |forward(P) − G| ÷ pixel size. So `run(0.125)` means
"every test point is drawn within 1/8 of the center pixel's size of where it
belongs".

**Bookkeeping.** For each triangle, target mode also stores the exact position
of its worst test point. When that point becomes a new vertex, the stored
position is used instead of projecting it again.

**Unchanged:** the test points, the priority queue, edge flipping, `run()`,
`getMaxError()`, and the source mode. In target mode the inverse functions are
never called, but `ReprojectionFns` still requires them.

**Cost.** For the same mesh with n splits and S test points, source mode makes
4 + n forward and S inverse projections; target mode makes 7 + S forward
projections (3 for the pixel size, none for new vertices). On NLCD, S is about
15 to 17 per split, so this saves about 5% of calls, plus whatever an inverse
costs over a forward.

**Later:** when the antimeridian work lands, its `wrapX` snap moves into this
metric (snap forward(P)'s x to the copy nearest G's x before measuring), and
the globe adds an option to measure in 3D.

### 2. Layer props and example toggles

- `RasterLayer` gets `_errorSpace?: "source" | "target"` (default `"source"`).
  It is passed to the reprojector and, like `maxError`, rebuilds the mesh when
  it changes. The globe path ignores it, because it builds a uniform grid. The
  underscore marks it experimental, and an `@internal` tag keeps it out of the
  generated API docs (the docs' typedoc config sets `excludeInternal`).
- `RasterTileLayer` gets the same prop and passes it to each tile's
  `RasterLayer` next to `maxError` (`_renderNormalTile`). `COGLayer`,
  `ZarrLayer` and `MultiCOGLayer` extend `RasterTileLayer`, so they need no
  code of their own.
- Changing the prop re-meshes visible tiles from data already loaded; nothing
  is fetched again.

Two examples get an "Error space: source / target" toggle next to their
existing mesh (debug) control, so you can flip between modes over the same view
and watch the wireframe:

- **land-cover** (the NLCD COG, Albers → Web Mercator): the mild case.
- **custom-projection** (EPSG:4326 and polar data in polar stereographic): the
  strong case. `ProjectedCOGLayer` passes `_errorSpace` to its `RasterLayer`s.
  In target mode it meshes the unstretched pixel grid: `meshXScale`, which
  exists only to approximate target-space error, is not applied.

### 3. Explainer: metric toggle

In `examples/explainers/reprojection-explainer`:

- **Setting.** `errorSpace` (`"source"` default) in `AppSettings`, chosen in
  the tuning panel next to the tolerance, flipped with the `M` key, and read
  from `?metric=target` on load (and kept in the URL with
  `history.replaceState` when changed, so a comparison can be linked).
  Changing it re-records the refinement and rebuilds the story, as changing the
  tolerance does today.
- **Refinement.** `recordRefinement` takes `errorSpace` and passes it to
  `RasterReprojector`. Meshes, counts and the replay come from the library.
- **Test points.** The explainer's copy of the error measurement
  (`measureTriangle`) gets the target-space version, using the reprojector's
  pixel size (read from its private state, as the explainer already does for
  the refinement queue). The existing invariant holds in both modes: a split
  lands on its triangle's worst test point.
- **Each mode draws the gap it measures.** Target mode labels the red-to-green
  gap on the map, as today. Source mode adds, in the input image, a line from
  each test point to where the GPU's drawn position maps back, and puts the
  labels there; the map's dots and gaps stay, unlabeled. Paused test points in
  the refine step follow the same rule.
- **Units.** Source mode keeps "px" in the counter and "input pixels" in step 3.
  Target mode uses "px on the map" and "pixels on the map" as draft wording;
  Kyle finalizes it. The "≈ km" conversion uses the scenario's kilometers per
  pixel in both modes.
- **Closing caption.** The library-default triangle count is computed per
  scenario and mode.

### 4. Explainer: scenario picker and the Arctic scenario

**Picker.** `?scenario=arctic` on load (kept in the URL like `metric`), plus a
select in the tuning panel. NLCD stays the default at the same URL. The other
scenarios from the scenario brainstorm can be added later on the same picker.

**A scenario defines:**

- its image (an asset), size and geotransform;
- the projection functions between the source CRS and the target, forward and
  inverse (source mode needs the inverse);
- the source and target projection names, for the panel subtitles;
- one reference parallel (latitude, longitude range, label), baked into the
  texture and drawn on the map;
- kilometers per pixel (the center pixel's ground size), for the counter;
- the default tolerance;
- the text for step 1, and the scenario-specific part of step 3's sentence
  (target name, where the worst point is, units). Steps 2 and 4–7 are generic.

The NLCD constants in `src/scene/nlcd.ts` become the NLCD scenario.
`build-scene`, `story`, `hud` and `texture` take a scenario instead of
importing NLCD constants. A test pins NLCD's current numbers (261 px seed
error, 194 triangles at 4 px, 6,001 at 0.125 px), so the default explainer does
not change.

**The Arctic scenario:**

- **Image.** NASA Blue Marble Next Generation (July 2004, topography and
  bathymetry, 5400×2700, EPSG:4326 plate carrée), cropped to 30–85°N and
  −179.9° to 179.9° and resampled to 2048×313 px. Checked in as a JPEG next to
  the NLCD PNG, with the commands to regenerate it in the README:

  ```bash
  curl -O https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x5400x2700.jpg
  gdal_translate -a_srs EPSG:4326 -a_ullr -180 90 180 -90 \
    world.topo.bathy.200407.3x5400x2700.jpg world.tif
  gdal_translate -projwin -179.9 85 179.9 30 -outsize 2048 313 \
    -of JPEG -co QUALITY=88 world.tif arctic-blue-marble-2048.jpg
  ```

  NASA imagery is free to use; the HUD and README credit "NASA Earth
  Observatory (Blue Marble Next Generation)".
- **Target.** EPSG:3413, NSIDC polar stereographic north:
  `+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`.
- **Reference line.** The Arctic Circle (66.56°N): straight in the image, a
  circle on the map. The reverse of NLCD's 49th parallel.
- **Layout.** The whole band: a 6.5:1 strip (about 820×126 slide px in the
  source panel) that rolls into a ring on the map.
- **Why it stops short of ±180° and the pole.** At exactly ±180° the image's
  left and right edges are the same meridian and source mode's inverse cannot
  tell them apart (it never converges). Stopping at 85°N keeps the pole, where
  every longitude meets, out of the image.
- **Numbers.** The center pixel's ground size is about 14 km. At 4 px the
  source metric needs about 1,100 triangles and the target metric about 980
  (from the probe above).
- **Text.** Kyle writes step 1 and step 3's sentence. Until then the code
  carries drafts, flagged in the PR as needing his text before merge.

### 5. Evaluation and the decision

**Evidence**, always both modes on the same input:

1. **A comparison script**, run on demand (not in CI), that prints a markdown
   table per case and tolerance: triangle count, worst error on the map, worst
   error in source pixels, projection calls and time. Cases: NLCD; the
   EPSG:4326 60–85°N tile in Web Mercator; the Arctic band in polar
   stereographic; a UTM tile; the `geotiff-test-data` fixtures.
2. **The examples** (section 2): flip the toggle with the mesh wireframe on, in
   headed Chrome.
3. **The explainer** (sections 3 and 4): NLCD and the Arctic scenario.

**Proposed bar for making target mode the default:**

- it meets its tolerance on the map in every case (true by construction; the
  script checks it);
- on typical mid-latitude data it adds at most about 25% more triangles at the
  default 0.125 tolerance (NLCD: +9%);
- it is no slower per mesh;
- the examples show no visual regressions.

Where target mode adds many triangles, as on the 60–85°N tile (+134%), that is
accuracy the source metric was missing, so it does not count against it.

## Testing

- **Reprojector:** target mode converges on a curved case; it never calls the
  inverse functions (the test passes ones that throw); the reported error
  equals a known distance on the map divided by the pixel size; reused vertex
  positions equal a fresh projection; an unmeasurable pixel size throws; source
  mode's meshes are unchanged.
- **Layers:** changing `_errorSpace` rebuilds a `RasterLayer`'s mesh with the
  new mode; `RasterTileLayer` passes it to each tile's `RasterLayer`.
- **Explainer:** the existing refinement and story invariants run in both
  modes; the Arctic scene builds and converges in both modes at every tolerance
  choice; NLCD's numbers are unchanged; `?metric` and `?scenario` select what
  they name; the `M` key flips the mode.

## Open questions

- **Arctic image source.** Blue Marble (above) is free of license conditions.
  The alternative is the EOxCloudless 2024 COG that the custom-projection
  example uses, which looks closer to current satellite imagery, but it is
  CC BY-NC-SA 4.0: a cropped copy checked into this repository would carry that
  non-commercial, share-alike license.
- **Wording.** The units in target mode and the Arctic scenario's text (see
  sections 3 and 4).
