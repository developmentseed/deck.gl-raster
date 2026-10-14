# Reprojection explainer

A step-by-step animation of how deck.gl-raster reprojects a raster on the GPU
with a triangle mesh. It works both as a talk prop and on its own.

By default the source is CONUS land cover (NLCD) stored in an Albers
equal-area projection, where the 49th parallel is a curve. The image is cut
into the mesh that `@developmentseed/raster-reproject` really builds, each
corner is moved to its exact Web Mercator position, and the GPU stretches the
image linearly inside each triangle. The animation itself is drawn the same way: as textured
triangles whose texture coordinates the GPU interpolates. Nothing reprojected
is stored; every frame is drawn live from the source image.

This is an [explainer](../../README.md#explainers): its code was generated with
an LLM and hasn't been reviewed, so don't treat it as a pattern to copy. It
explains the algorithm rather than showing how to use the library's layers: it draws with its own `TexturedTrianglesLayer`
instead of `RasterLayer`, and `src/scene/refinement.ts` reads
`RasterReprojector`'s private refinement queue to record each split.

## Scenarios

The tuning panel's Scenario select (or `?scenario=` in the URL) picks the
image and target projection:

| Scenario | URL | Image | Target | Reference line |
|---|---|---|---|---|
| NLCD land cover (default) | `?scenario=nlcd` | Albers equal-area | Web Mercator | 49°N |
| Arctic | `?scenario=arctic` | Longitude/latitude, 30–85°N | Polar stereographic (EPSG:3413) | Arctic Circle |

The Arctic's step 1 text is a draft, marked "[Draft]".

## Error metric

`RasterReprojector` can measure each test point's error in two places, set by
its experimental `_errorSpace` option. The tuning panel's "Error measured"
select, the M key, or `?metric=output` in the URL switch between them:

- **In input pixels** (`"input"`, the default): the GPU's drawn position is
  mapped back into the image, and the error is its distance from the test
  point, in input pixels. The input image shows that gap as a red line.
- **In output pixels** (`"output"`): the error is the distance on the map
  between where the GPU draws the test point and where it belongs, divided by
  one input pixel's size on the map at the image center.

Each mode refines toward its own worst point, so the meshes differ, and so
can the worst point of the 2-triangle mesh: in output pixels, NLCD's is the
middle of the top edge rather than the center.

## Steps

1. **The input image**: the image as stored, and the true reference line on
   the map.
2. **Two triangles**: the image is split into 2 triangles.
3. **Project the corners**: the 2 triangles fly over. Their corners land
   exactly, but the edges between them miss the true outline.
4. **Measure the error**: the test points of both triangles (currently each
   triangle's centroid and edge midpoints), where the GPU draws them, and
   where they belong. Each error is labeled where it is measured: in the
   input image, or on the map.
5. **Refine the mesh**: the library's refinement, replayed one split at a time.
   Each split lands where the straight-line guess is furthest off, and the new
   corner snaps to its exact position. Triangles are tinted by their error,
   which fades as the mesh converges. A slider scrubs through the splits;
   pausing shows the split triangle's test points.
6. **Map each triangle**: every triangle of the final mesh flies into place.
7. **Done**: the edges fade, leaving the reprojected image.

Each step has a title and a description. The control bar at the bottom
appears when the mouse moves, and hides when it rests so it stays off the
screen while presenting from the keyboard.

## Keys

| Key | Action |
|---|---|
| → / Space / PageDown | Finish the current animation, or go to the next step |
| ← / PageUp | Previous step |
| R | Replay the current step |
| 1–7 | Jump to a step |
| D | Show or hide the step descriptions |
| F | Switch flight style (direct, or fly then snap) |
| M | Switch where the error is measured (input pixels, or the map) |
| P | Open or collapse the tuning panel (the sidebar on the left) |

The scenario and the error metric are kept in the URL, so a view can be
linked.

## Data

`src/assets/nlcd-albers-2500.png` is the 2023 Annual NLCD land cover COG,
downsampled to 2500×1641 px (about 1.9 km per pixel) and colored with the
NLCD palette. Its georeferencing is hard-coded in `src/scene/nlcd.ts`,
because browsers ignore GDAL's `.aux.xml` sidecar.

`src/assets/arctic-blue-marble-2048.jpg` is NASA's
[Blue Marble Next Generation](https://earthobservatory.nasa.gov/features/BlueMarble)
(July 2004, topography and bathymetry), credited to NASA Earth Observatory. It
is cropped to 30–85°N and resampled to 2048×313 px:

```bash
curl -O https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x5400x2700.jpg
gdal_translate -a_srs EPSG:4326 -a_ullr -180 90 180 -90 \
  world.topo.bathy.200407.3x5400x2700.jpg world.tif
gdal_translate -projwin -179.9 85 179.9 30 -outsize 2048 313 \
  -of JPEG -co QUALITY=88 world.tif arctic-blue-marble-2048.jpg
```

GDAL snaps the window to the source's 1/15° pixels, so the band spans
±179.933°, as hard-coded in `src/scene/arctic.ts`. It stops short of ±180°
because at exactly ±180° the left and right edges are the same meridian,
which input mode's inverse projection can't tell apart.

## Run

```bash
pnpm install
pnpm build   # the example imports the workspace packages from their dist/
cd examples/explainers/reprojection-explainer
pnpm dev
```
