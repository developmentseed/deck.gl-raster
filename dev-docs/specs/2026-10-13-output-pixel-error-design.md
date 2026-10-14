# Output-pixel error mode for the reprojector

- **Date:** 2026-10-13
- **Issues:** related to [#673](https://github.com/developmentseed/deck.gl-raster/pull/673) (antimeridian), [#566](https://github.com/developmentseed/deck.gl-raster/issues/566) (globe faceting), [#694](https://github.com/developmentseed/deck.gl-raster/pull/694) (custom projections); previewed end to end in [#708](https://github.com/developmentseed/deck.gl-raster/pull/708)
- **Status:** Sections 1, 2 and 5 implemented: the reprojector option, the layer prop, the example toggles and the comparison script. Sections 3 and 4 (the explainer) follow in a separate PR.

## Problem

`RasterReprojector` refines a triangle mesh until every triangle's error is
below a tolerance (`maxError`, default 0.125). Today that error is measured in
**input pixels**, through the inverse projection. This mirrors gdalwarp's
approximate transformer, but our output differs from gdalwarp's in ways that
make a source-pixel tolerance give uneven accuracy on screen, and the inverse
projection causes failures of its own. Several pending designs depend on how
error is measured: antimeridian crossing (#673), the globe (#566) and arbitrary
view projections (deck.gl v10). This spec adds an opt-in **output-pixel** metric
and the tools to compare the two side by side, so we can decide the default.

### How error is measured today

Each triangle is tested at a few points: currently its centroid and the
midpoint of each edge. For a test point P:

- the GPU draws P at **G**, the blend of the triangle's corner positions by
  P's barycentric weights;
- the **input-pixel metric** maps G back into the image (`inverseReproject`, then
  `inverseTransform`) and reports the distance, in input pixels, between P and
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
  piecewise-linear mapping is from the exact one: the input metric as the
  wrong data pixel at a fixed screen spot, the output metric as the wrong screen
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
swapped, before the pixel size became √|det J| (section 1; section 5's script
gives current numbers). Output-mode errors are in output pixels: units of one
input pixel's size on the map at the tile center (defined below), so both
modes' tolerances mean "1/8 of a pixel" at the zoom the tile is drawn at.
"Worst error on the map" uses the same unit.

| Case | Input mode | Output mode |
|---|---|---|
| NLCD (Albers → Web Mercator), 0.125 px | 6,001 triangles; worst error on the map 0.147 | 6,563 triangles |
| NLCD, 4 px | 194 triangles | 160 triangles |
| EPSG:4326 tile 60–85°N → Web Mercator, 0.125 px | 2,394 triangles; worst error on the map 0.54 | 5,602 triangles |
| EPSG:4326 band 30–85°N (±179.9°) → polar stereographic, 4 px | 1,038 triangles, 38% of vertices north of 70°N | 980 triangles, 13% north of 70°N |
| EPSG:4326 band 70–88°N, all longitudes → polar stereographic | never converges (the inverse confuses the two edges) | 10,524 triangles |
| EPSG:3832 world tile reaching −87° (rows squashed by the ±85.05° clamp) | stuck at 32 px | 360 triangles |
| UTM 60N tile across 180°, with inverse functions that throw | needs the inverse | 40 triangles; inverse never called |

The metrics mainly move *where* triangles go. Their totals stay close when the
parts of a tile that need refinement sit on both sides of the center (the two
rulers agree at the center and err in opposite directions away from it), and
diverge when they sit on one side (the 60–85°N tile, where Web Mercator bends
hardest near 85°N, exactly where pixels are biggest on the map).

## Goals

- An opt-in output-pixel mode in `RasterReprojector`, with `maxError` keeping
  its meaning: a number of pixels.
- Compare the two modes side by side on real data (in two examples) and in the
  reprojection explainer, including a scenario where they differ strongly.
- Gather the evidence to decide which mode should be the default.

## Non-goals

Each of these is a separate change after this one:

- Per-tile `metersPerPixel` in tile selection (today one value per level).
- Reworking the antimeridian handling (#673) on top of output mode.
- Measuring in 3D for the globe.
- Making the inverse functions optional in `ReprojectionFns`.
- The other scenarios from the explainer scenario brainstorm (World → Equal
  Earth, Americas → orthographic, a Sentinel-2 tile → Web Mercator).
- Guarding the reprojector against zero-area triangles (found while reviewing
  #673: a tile containing a pole can recurse in edge flipping until the stack
  overflows).

## Design

### 1. `RasterReprojector`: the `_errorSpace` option

```ts
new RasterReprojector(reprojectors, width, height, {
  initialTriangulation,
  _errorSpace: "output", // "input" (default) | "output"
});
```

`_errorSpace` defaults to `"input"`, so nothing changes unless a caller opts
in. The underscore and the option's docstring mark it experimental.

**Pixel size.** In output mode, the constructor measures one input pixel's
size on the map once, before the first triangles are measured. This is the
unit of output-mode error, one output pixel:

1. Take the center of the initial triangulation's UV bounds: the tile center
   by default, or the center of a smaller seed such as the Web Mercator pole
   clamp's.
2. Convert it to pixel coordinates the way the reprojector does
   (`u · (width − 1)`, `v · (height − 1)`), and project the points half a
   pixel to its left and right and half a pixel above and below it
   (`forwardTransform`, then `forwardReproject`). The differences are `r` and
   `d`: where one pixel across and one pixel down go on the map, the columns
   of the projection's Jacobian `J` there.
3. The pixel covers the parallelogram `r` and `d` span, of area
   `|det J| = |r.x·d.y − r.y·d.x|`. The pixel size is `√|det J|`, the side of
   a square with that area, as `metersPerPixel` takes `sqrt(|a·e|)` of a
   geotransform. Where the pixel's sides meet at right angles this equals the
   geometric mean of `|r|` and `|d|`; where the pixel is sheared, the
   geometric mean overstates it. MODIS sinusoidal pixels far from the central
   meridian are sheared by about 40° in Web Mercator, and the geometric mean
   would make the tolerance 16% looser there.
4. If the result is not a finite positive number, throw an error that names the
   mode, the UV center, the image size and the value. (Output mode is
   experimental; failing loudly helps find such cases.)

For #673's antimeridian pieces, which can be triangles, the measuring point
should become the seed's area-weighted centroid: the bounding box's center of
a triangle lies on its long edge, which there is the cut. For rectangles, the
only seeds today, the two are the same point.

**Error.** For each test point, with P its pixel coordinates and G its blended
GPU position: error = |forward(P) − G| ÷ pixel size. So `run(0.125)` means
"every test point is drawn within 1/8 of the center pixel's size of where it
belongs".

**Bookkeeping.** For each triangle, output mode also stores the exact position
of its worst test point. When that point becomes a new vertex, the stored
position is used instead of projecting it again. A triangle is only split when
a test point had a real error, so the stored position needs no sentinel.

**Unchanged:** the test points, the priority queue, edge flipping, `run()`,
`getMaxError()`, and input mode. In output mode the inverse functions are
never called, but `ReprojectionFns` still requires them.

**Cost.** For the same mesh with n splits and S test points, input mode makes
4 + n forward and S inverse projections; output mode makes 8 + S forward
projections (4 for the pixel size, none for new vertices). On NLCD, S is about
15 to 17 per split, so this saves about 5% of calls, plus whatever an inverse
costs over a forward.

**Later:** when the antimeridian work lands, its `wrapX` snap moves into this
metric (snap forward(P)'s x to the copy nearest G's x before measuring), and
the globe adds an option to measure in 3D.

### 2. Layer props and example toggles

- `RasterLayer` gets `_errorSpace?: "input" | "output"` (default `"input"`).
  It is passed to the reprojector and, like `maxError`, rebuilds the mesh when
  it changes. The globe path ignores it, because it builds a uniform grid. The
  underscore marks it experimental, and an `@internal` tag keeps it out of the
  generated API docs (the docs' typedoc config sets `excludeInternal`).
- If the mesh can't be built (output mode can't measure a pixel size, or a
  projection function throws), `RasterLayer` draws nothing and reports the
  error through deck.gl's `raiseError`, rather than keep drawing the mesh from
  earlier props.
- `RasterTileLayer` gets the same prop and passes it to each tile's
  `RasterLayer` next to `maxError` (`_renderSubLayers`). `COGLayer`,
  `ZarrLayer` and `MultiCOGLayer` extend `RasterTileLayer`, so they need no
  code of their own.
- Changing the prop re-meshes every cached tile from data already loaded, as
  changing `maxError` does; nothing is fetched again. Today that relies on
  `RasterTileLayer` passing `TileLayer` a new `TilesetFactory` class on every
  render; [#710](https://github.com/developmentseed/deck.gl-raster/issues/710)
  makes the dependency explicit.

Two examples get a "Mesh error measured" select (in input pixels, or in output
pixels) under their existing "Debug overlay" control, so you can flip between
modes over the same view and watch the wireframe:

- **land-cover** (the NLCD COG, Albers → Web Mercator): the mild case.
- **custom-projection** (EPSG:4326 and polar data in polar stereographic): the
  strong case. `ProjectedCOGLayer` passes `_errorSpace` to its `RasterLayer`s.
  In output mode it meshes the unstretched pixel grid: `meshXScale`, which
  exists only to make input-pixel error track error on the map, is not
  applied.

### 3. Explainer: metric toggle

Sections 3 and 4 come in a separate PR. In
`examples/explainers/reprojection-explainer`:

- **Setting.** `errorSpace` (`"input"` default) in `AppSettings`, chosen in
  the tuning panel next to the tolerance, flipped with the `M` key, and read
  from `?metric=output` on load (and kept in the URL with
  `history.replaceState` when changed, so a comparison can be linked).
  Changing it re-records the refinement and rebuilds the story, as changing the
  tolerance does today.
- **Refinement.** `recordRefinement` takes `errorSpace` and passes it to
  `RasterReprojector`. Meshes, counts and the replay come from the library.
- **Test points.** The explainer's copy of the error measurement
  (`measureTriangle`) gets the output-mode version, using the reprojector's
  pixel size (read from its private state, as the explainer already does for
  the refinement queue). The existing invariant holds in both modes: a split
  lands on its triangle's worst test point.
- **Each mode draws the gap it measures.** Output mode labels the red-to-green
  gap on the map, as today. Input mode adds, in the input image, a line from
  each test point to where the GPU's drawn position maps back, and puts the
  labels there; the map's dots and gaps stay, unlabeled. Paused test points in
  the refine step follow the same rule. Each label sits past the gap's true
  end (the test point in the image, the exact spot on the map), and moves
  beside its dot where that would cover the panel titles, the counter or the
  description.
- **Where the first attempt is worst.** Step 3 names the 2-triangle mesh's
  worst test point from the recorded refinement rather than assuming it,
  because it moves with the metric: NLCD's is the image center in input
  pixels but the middle of the top edge in output pixels, where Web Mercator
  stretches the map most.
- **Units.** Input mode keeps "px" in the counter and "input pixels" in step
  3; output mode says "output px" and "output pixels". The "≈ km" conversion
  uses the scenario's kilometers per pixel in both modes.
- **Closing caption.** The library-default triangle count is computed per
  scenario and mode, running up to 25,000 iterations (the Arctic band needs
  about 17,000).

### 4. Explainer: scenario picker and the Arctic scenario

**Picker.** `?scenario=arctic` on load (kept in the URL like `metric`), plus a
select in the tuning panel. NLCD stays the default at the same URL. The other
scenarios from the scenario brainstorm can be added later on the same picker.

**A scenario defines:**

- its image (an asset), size and geotransform;
- the projection functions between the source CRS and the target, forward and
  inverse (input mode needs the inverse);
- the source and target projection names, for the panel subtitles;
- one reference parallel (latitude, longitude range, label), baked into the
  texture and drawn on the map;
- kilometers per pixel (the center pixel's ground size), for the counter;
- the default tolerance;
- the text for step 1, and the scenario-specific part of step 3's sentence
  (target name; the story fills in where the worst point is and the units).
  Steps 2 and 4–7 are generic.

The NLCD constants in `src/scene/nlcd.ts` become the NLCD scenario.
`build-scene`, `story`, `hud` and `texture` take a scenario instead of
importing NLCD constants. A test pins NLCD's current numbers (261 px seed
error, 194 triangles at 4 px, 6,001 at 0.125 px), so the refactor doesn't change
the default explainer. (Section 3 does: input mode now draws its gaps in the
input image in step 4.)

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
  left and right edges are the same meridian and input mode's inverse cannot
  tell them apart (it never converges). Stopping at 85°N keeps the pole, where
  every longitude meets, out of the image.
- **Numbers.** The center pixel's ground size is about 14 km. At 4 px input
  mode needs 1,038 triangles and output mode 980.
- **Text.** Kyle writes step 1 and step 3's sentence. Until then the code
  carries drafts, flagged in the PR as needing his text before merge.

### 5. Evaluation and the decision

**Evidence**, always both modes on the same input:

1. **A comparison script**, run on demand (not in CI), that prints a markdown
   table per case and tolerance: triangle count, worst error in output pixels
   and in input pixels, projection calls and time. Cases: the reprojector's
   JSON fixtures (NLCD in Albers, NAIP in UTM 18N, LINZ in NZTM, MODIS in
   sinusoidal; each scaled to an overview at most 2048 px on its long side) in
   Web Mercator; an EPSG:4326 60–85°N tile in Web Mercator; an EPSG:4326
   67.5–89.9°N tile and the 30–85°N band in polar stereographic. Run it with
   `COMPARE_ERROR_SPACES=1 pnpm exec vitest run tests/compare-error-spaces.test.ts --silent=false`
   in `packages/raster-reproject`.
2. **The examples** (section 2): flip the toggle with the mesh wireframe on, in
   headed Chrome.
3. **The explainer** (sections 3 and 4): NLCD and the Arctic scenario.

**Proposed bar for making output mode the default:**

- it meets its tolerance on the map in every case (true by construction; the
  script checks it);
- on typical mid-latitude data it adds at most about 25% more triangles at the
  default 0.125 tolerance (NLCD: +9% at 2500 px wide but −11% at a 2048 px
  overview; the sign varies with the image and the tolerance);
- it is no slower per mesh;
- the examples show no visual regressions.

Where output mode adds many triangles, as on the 60–85°N tile (+134%), that is
accuracy input mode was missing, so it does not count against it.

**Decision (2026-10-14):** ship output mode as an experimental option now, and
consider making it the only mode in a later PR, before or after the next
release. Input mode needs an invertible (1:1) projection; output mode only
needs the forward projection, which can be N:1, as at a polar map's pole or
along the antimeridian. On every case measured it is as accurate or more on
screen, and it converges where input mode cannot.

## Testing

- **Reprojector:** output mode converges on a curved case; it never calls the
  inverse functions (the test passes ones that throw); the reported error
  equals a known distance on the map divided by the pixel size; a sheared
  pixel's size comes from its area; reused vertex positions equal a fresh
  projection; an unmeasurable pixel size throws; input mode's meshes are
  unchanged.
- **Layers:** changing `_errorSpace` rebuilds a `RasterLayer`'s mesh with the
  new mode, and leaving it unchanged doesn't; a mesh that can't be built draws
  nothing and reports the error; `RasterTileLayer` passes the prop to each
  tile's `RasterLayer`.
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
- **Wording.** The Arctic scenario's text (see section 4). The units are
  settled: "input pixels" and "output pixels".

## Follow-ups

- **Output mode only** (see the decision in section 5). That PR can also delete
  input mode's workarounds in the custom-projection example: the `meshXScale`
  column stretch, the 89.5° cut at the poles (input mode can't converge where
  a whole row of a geographic tile meets at the pole), and the longitude
  unwrap in `tileInverseReproject`.
- **The explainer:** sections 3 and 4, closing #708.
- **[#710](https://github.com/developmentseed/deck.gl-raster/issues/710):**
  pass `maxError`, `debug`, `debugOpacity` and `_errorSpace` to tiles through
  `updateTriggers` instead of a new `TilesetFactory` class on every render.
- **[#566](https://github.com/developmentseed/deck.gl-raster/issues/566):** the
  globe, measuring output-pixel error in 3D.
- **#673:** antimeridian handling on output mode, with the pixel size measured
  at the seed's area-weighted centroid.
