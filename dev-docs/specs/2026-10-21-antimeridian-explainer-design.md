# Antimeridian Explainer: Meshing Across 180°

- **Date:** 2026-10-21
- **Issues:** background: [#703](https://github.com/developmentseed/deck.gl-raster/pull/703) (the first antimeridian explainer, for [#673](https://github.com/developmentseed/deck.gl-raster/pull/673)'s design), [#716](https://github.com/developmentseed/deck.gl-raster/pull/716) (the mechanism this explains), [#721](https://github.com/developmentseed/deck.gl-raster/pull/721) (output-pixel error in every layer)
- **Status:** Draft

## Problem

An image that crosses the antimeridian (±180°) can't be meshed the usual way.
A projection returns every x in one copy of the world, so the pixels just east
of 180° come back a whole world away from their neighbours just west of it.
Any triangle with corners on both sides stretches across the entire map, and
no amount of refining fixes it: the jump is in the projection, not in the
mesh.

deck.gl-raster now handles this in a few lines of code spread over three
packages. A `RasterLayer` with `_wrapX` set:

1. **unwraps the corners:** `makeUnwrappedReprojectionFns` walks from the
   image's center to each corner with `unwrapAlong`;
2. **snaps every point:** it moves every projected x to the copy nearest the
   blend of the unwrapped corners, with `nearestCopy`;
3. **meshes as usual:** it lets the planar reprojector mesh the now continuous
   projection, measuring error in output pixels; and
4. **cuts at the world's edge:** it cuts the mesh there with `clipMeshToWorld`.

The design went through six attempts: #269, #374, #576, #673, #714, and then
#716. The explainer for #673's design, #703, now describes code that no longer
exists. Its corners walked from corner to corner, and points were snapped
inside the reprojector.

The goal is to understand how the meshing happens around the antimeridian,
starting with the maintainer. The explainer also serves talks and users, like
the reprojection and multi-cog explainers.

## Goals

- Follow one real image that crosses 180° through the mesh-building steps
  that `RasterLayer` runs today, and show with the library's real numbers:
  1. why a plain projection can't be meshed: triangles span the world, and
     refinement stalls;
  2. how walking from the center unwraps the corners;
  3. how snapping to the blend of the corners makes every point continuous;
  4. that the reprojector then meshes it like any other image; and
  5. how the mesh is cut at the world's edge, and the part beyond moved one
     world over, so the map's world copies draw it seamlessly.
- Compute every corner, sample, snapped position, split and clipped triangle
  by calling the same functions `RasterLayer` calls, in the same order
  (`makeUnwrappedReprojectionFns`, `RasterReprojector`, `clipMeshToWorld`,
  with `unwrapAlong` and `nearestCopy` underneath), so the explainer can't
  drift from the layer.
- Work as a talk prop (keyboard-driven, legible on a projector) and on its
  own (a title and a description for every step).

## Non-goals

- Choosing tiles across world copies (#518), and MosaicLayer choosing source
  images across the antimeridian (#639, #752). This is about one image's mesh.
- Images that contain a pole, where no unwrap is continuous. A sentence can
  mention the limit, but the story doesn't show it.
- Error measured in input pixels. Layers no longer use it (#721), and with
  `_wrapX` it can't work, because the inverse projection is still wrapped.
- The globe view and other target projections. `_wrapX` is Web Mercator's
  common space: `RasterTileLayer` sets it only in its Web Mercator branch,
  and other projections will need a revisit (Kyle, 2026-10-15).
- A tile pyramid. The image is one tile, so the story is one mesh.

## Anti-goals

- Any corner, sample, snapped position, split or cut that is drawn by hand
  instead of coming from the real functions.
- Restating #703's text. It describes #673's mechanism: walking corner to
  corner, snapping to the point before, and `_candidatesOutX`. Every claim
  must match the code on `main`.
- Reading `RasterLayer`'s private state. The explainer calls the functions
  the layer calls. It may read `RasterReprojector`'s refinement queue to
  record splits, as the reprojection explainer does.

## Source data

`antimeridian_UTM_60N.tif` from geotiff-test-data, the fixture #703 used. It
is read live from GitHub, pinned to the commit that added it:

`https://raw.githubusercontent.com/developmentseed/geotiff-test-data/7d46e23/rasterio_generated/fixtures/antimeridian_UTM_60N.tif`

GitHub serves it with range requests and `Access-Control-Allow-Origin: *`
(checked: `206`, `content-range: bytes 0-99/665`), so `GeoTIFF.fromUrl` can
read it from the browser.

| Property | Value |
|---|---|
| CRS | EPSG:32660 (WGS 84 / UTM zone 60N) |
| Size | 42 x 42 px, one 64 x 64 block, deflate, 665 bytes |
| Pixel size | 20 km |
| Origin | (300000, 6200000) |
| Values | UInt8 1-42, one per column (a west-to-east ramp); nodata 0 |
| Corners | NW 173.80°E 55.90°N, NE 172.84°W 55.52°N, SW 174.30°E 48.36°N, SE 174.41°W 48.07°N |
| Center | 179.79°W 52.13°N |

The 180° meridian crosses the image at a slant of about 2.4°, from UTM's grid
convergence this far from zone 60's central meridian (177°E). Within the image
it is straight to 0.02 px.

### The mesh, measured with the real functions

These numbers come from running the functions built on `main`, in Web
Mercator common space (one world is 512 units wide, and x 0 is -180°), with
`period` 512 and `maxError` 0.125, as `RasterLayer` runs them:

- **Center:** x 0.30, just east of the world's west edge.
- **Corners as projected:** NW 503.18, NE 10.18, SW 503.89, SE 7.96. The
  west corners land at the map's east edge, a world away from the east ones.
- **The walk:** each corner's walk takes two samples, the midpoint and the
  corner, since no step moves a quarter of a world. NW's midpoint comes back
  at 508.0, nearest copy -4.0, and its corner at 503.2, nearest copy -8.8.
- **Corners unwrapped:** NW -8.82, NE 10.18, SW -8.11, SE 7.96. The wrapped
  functions return the same values at the corners.
- **Without the unwrap:** refinement stops at its iteration cap: 20,001
  triangles, 616 output pixels of error, one triangle 511.97 units wide. The
  library warns "mesh refinement did not converge".
- **With the unwrap:** 40 triangles, x from -8.82 to 10.18, the widest 4.78
  units.
- **The cut:** 10 of the 40 triangles cross x 0. `clipMeshToWorld` leaves 60
  triangles, all with x in [0, 512].

### Colors

The values are a ramp from west to east. They are colored with #703's
viridis-like ramp, so the image's continuity across the seam is visible.
Nearest filtering keeps the 20 km pixels crisp.

## Storyboard

Steps are numbered from 1 on screen, as in the multi-cog explainer, so the
digit keys match.

1. **An image across 180°.** The image as stored (42 x 42 px of 20 km, UTM
   60N), with the 180° meridian crossing it at a slant. Beside it, the whole
   Web Mercator world, with the image's footprint astride the map's edges.
2. **Two triangles.** The reprojector starts from two triangles over the
   image, as for any image.
3. **Project the corners.** proj4 returns each corner in one copy of the
   world: the west corners at the map's east edge (x 503), the east corners
   at its west edge (x 8-10). Both triangles stretch across the whole world.
4. **Refining can't fix it.** A time-lapse of the reprojector refining the
   plain projection: the mesh grows to 20,001 triangles and is still 616
   output pixels off. The triangles along 180° still span the world.
5. **Walk to the corners.** From the image's center (x 0.30), a walk toward
   each corner. Each sample comes back from proj4 in one copy (red), and
   `unwrapAlong` moves it to the copy nearest the step before (green). The
   west corners come out at x -8.8 and -8.1, past the world's west edge,
   instead of 503.
6. **Snap every point.** A probe sweeps across the image, west to east and
   back. proj4's answer (red) jumps a whole world as the probe crosses 180°.
   The snapped point, moved to the copy nearest the blend of the four
   unwrapped corners at the probe (`nearestCopy`), moves smoothly.
7. **Mesh as usual.** The library's refinement of the snapped projection,
   replayed one split at a time: 40 triangles. In both map views, the mesh
   now hangs past the world's west edge.
8. **Cut at the world's edge.** The 10 triangles that cross x 0 are cut along
   it (`clipMeshToWorld`). In the image panel, the cut appears as a polyline
   along the 180° meridian. The part past the edge moves one world over, to
   x 503-512.
9. **On the map.** The map draws a copy of every world, so the moved part
   appears beside the seam again. The textured image is continuous across
   180°. A caption points to the reprojection explainer for how refinement
   chooses its splits.

## Design

The app copies the reprojection explainer's machinery: the triangle layers,
the flights, the refinement recorder and the player. It also copies the
multi-cog explainer's shell: the HUD, control bar, side panel, loading screen
with progress, and 1-based step numbers. Copying rather than sharing keeps
both untouched. All three are unreviewed code (see
`examples/README.md#explainers`). #703's antimeridian-specific pieces are
starting points, rewritten for today's mechanism: its story, ramp and
meridian lines. Its hard-coded georeferencing (`utm60n.ts`) is replaced by
reading the file.

### Layout

One `OrthographicView` (with `flipY`) over a fixed 1920 x 1080 slide,
letterboxed, with the HTML title, captions and description in slide units.
Two panels:

- **Image panel** (left): the image in pixel space, with the 180° meridian,
  the center, the corners, the walk paths, the probe, the triangles in UV
  space, and the cut.
- **Map panel** (right): Web Mercator common space, with the world's edges at
  x 0 and 512 marked, a few graticule lines, and the triangles at their
  output positions.
  - **Steps 1-4:** the whole panel shows the whole world, framed a little past
    both edges (about x -16 to 528), so the world-spanning triangles are the
    subject.
  - **From step 5:** the panel splits.
    - On top, a **world strip** keeps that whole-world framing, about a
      quarter of the panel's height. It is where proj4's raw answers (red)
      appear, a world away.
    - Below, a **seam close-up** (about x -12 to 14) shows the image's mesh
      in detail, with the region past the world's edge (x < 0) marked.
    - A thin leader line links each raw point in the strip to its snapped
      point (green) in the close-up.

  Each view clips to its own box. Separate deck.gl views would do it, which
  is the builder's call. Coastlines would help an audience recognize the
  Bering Sea, and a live Natural Earth file is allowed; that is the builder's
  call too.

### Data loading

The data is fetched live; bundling it isn't needed. At startup, behind a
loading screen with a progress bar, the app:

1. opens the file with `GeoTIFF.fromUrl` and checks its size, transform and
   CRS against the Source data table, failing with a clear message if they
   differ;
2. reads its pixels with the library, without `boundless`, so the 42 x 42 image
   is cut from its 64 x 64 block;
3. builds the image's reprojection functions as COGLayer and `RasterTileLayer`
   build them for Web Mercator:
   - `forwardTransform` and `inverseTransform` from the file's transform;
   - `forwardReproject` maps the source CRS into common space, the way
     `RasterTileset2D.projectPosition` does (proj4 to EPSG:3857, then rescaled
     to common space);
   - `inverseReproject` is its inverse; and
4. runs everything the story draws, once:
   - the plain refinement, recorded at a few triangle counts for the
     time-lapse;
   - the corner walks, recorded;
   - the snapped refinement, recorded split by split;
   - the clip.

   Each call matches `RasterLayer`'s in its arguments, including
   `makeUnwrappedReprojectionFns` with the image's width and height, and
   `RasterReprojector` with width + 1 and height + 1.

**The walk's samples** are recorded by calling `unwrapAlong` with a recording
`valueAt`, along the same path `makeUnwrappedReprojectionFns` walks: from the
center to just short of each corner. A test checks that each walk ends where
the real wrapped functions put that corner. A difference means the explainer's
path has drifted from the library's.

**The probe's snap** in step 6 is what the wrapped `forwardReproject` returns.
proj4's raw answer is drawn beside it.

### Rendering

- **The image and the textured mesh:** the reprojection explainer's
  textured-triangle layer, drawing the colored image (nearest filtering) on
  triangles in either panel.
- **Lines, outlines, dots and arrows:** stock layers (`PathLayer`,
  `PolygonLayer`, `ScatterplotLayer`).
- **The final step:** draws the clipped mesh in the world copies that the
  seam framing shows. That is the same mesh `RasterLayer` would draw.

### Animation

As in the other explainers:

- each step is `{ id, title, description, durationMs, frame(timeMs) }`, where
  `frame` is a pure function;
- a `Player` holds the current step and its start time;
- a `requestAnimationFrame` loop turns frames into layers; and
- React renders only the HTML.

Movement that carries meaning:

- **Step 3:** the corners fly from the image to where proj4 puts them.
- **Step 4:** the time-lapse.
- **Step 5:** the split into strip and close-up, then the walk, sample by
  sample: each raw sample in the strip, its copy in the close-up.
- **Step 6:** the probe.
- **Step 7:** the refinement replay.
- **Step 8:** the cut in the close-up, then the move one world over, shown
  in the strip.

Check every step mid-animation, not only at its end: the multi-cog
explainer's final review found a flight drawn under a picture that end-state
screenshots never showed. Dev builds expose `player().seek(t)` for this.

### Controls

The multi-cog explainer's keys:

| Key | Action |
|---|---|
| → / Space / PageDown | Finish the current animation, or go to the next step |
| ← / PageUp | Previous step, shown in its end state |
| R | Replay the current step |
| 1-9 | Jump to a step |
| D | Show or hide the step descriptions |
| P | Open or close the side panel (keys, links and data) |

Also: the auto-hiding control bar, focus handling for presentation clickers,
and the descriptions setting in `localStorage`, under its own key.

### Where it lives

`examples/explainers/antimeridian-explainer`, on a fresh branch from `main`.
#703's branch isn't reused.

- **Scaffold:** package `deck.gl-antimeridian-explainer-example`, Vite `base`
  `/deck.gl-raster/examples/antimeridian-explainer/`, and
  `worker: { format: "es" }` (it imports `@developmentseed/geotiff`). Also the
  standard scripts, tsconfig and `ExampleProvider`.
- **Dependencies:** as the multi-cog explainer's, plus
  `@developmentseed/raster-reproject` and `@developmentseed/proj`.
- **Library access:** `makeUnwrappedReprojectionFns` and `clipMeshToWorld`
  aren't exported from `@developmentseed/deck.gl-raster`, and its export map
  blocks deep imports. The explainer reaches them through a private
  specifier, `@developmentseed/deck.gl-raster/internal/<module>`, mapped in
  its own config:
  - `resolve.alias` in `vite.config.ts` points at
    `packages/deck.gl-raster/dist/<module>.js`. vitest reads the same config.
  - A matching `paths` entry in `tsconfig.json` points at `dist/<module>.d.ts`
    (the examples resolve modules in `bundler` mode).

  The alias applies to the explainer's build as well as its dev server,
  because the docs site builds every example. The package's exports and
  export map don't change, so no consumer can reach these modules. The
  explainer runs the shipped `dist/` code, and renaming those files fails
  the explainer's typecheck in CI.
- **README:** the explainer disclaimer, the steps, keys, data provenance and
  how to run it.
- **Docs card:** an entry in `explainerExamples`, with a card image.
- **#703:** the new PR closes it.

## Testing

- **Unit tests** (vitest, node environment), with fakes and no network:
  - the measured numbers above, through the real functions: corners raw and
    unwrapped, each walk's samples and end, 40 triangles, and 10 crossing
    triangles cut to 60;
  - that each walk ends where the wrapped functions put the corner;
  - that the plain refinement doesn't converge, and that a triangle spans
    more than half a world;
  - the probe's raw and snapped x on both sides of 180°;
  - each step's frame at its start and end, frames being pure, and the slide
    layout.
- **Typecheck, Biome and the example's build**, as in CI.
- **Visual check** of every step in headed Chrome at 1920 x 1080 and
  1024 x 768, mid-animation as well as at each end, with screenshots.

## Open questions

- To settle while watching it: timing, the strip's height, whether
  coastlines are worth it, and how many frames the time-lapse shows.

## Decisions

Decided with Kyle (2026-10-21):

- The explainer is about how the mesh is built around the antimeridian, and
  shows today's mechanism (#716, #721), keeping #703's story and visuals.
- Tile selection across world copies and MosaicLayer source selection stay
  out.
- It is a standalone app like the multi-cog explainer, on a fresh branch.
- The data can be fetched live.
- The explainer reaches `makeUnwrappedReprojectionFns` and `clipMeshToWorld`
  through a private alias in its own Vite and TypeScript config, pointing at
  `dist/`. The library's exports stay unchanged.

Decided while drafting:

- The image is #703's fixture, read live from GitHub at a pinned commit,
  instead of hard-coding its georeferencing.
- Nine steps, with a time-lapse of the stalled refinement (step 4), and a
  probe sweep for the snap (step 6).
- The map panel shows the whole world for steps 1-4. From step 5 it shows
  a whole-world strip, where raw answers appear a world away, over a close-up
  of the seam for the mesh, with leader lines between them.
- Walk samples are recorded by calling `unwrapAlong` along the library's
  path. A test checks them against the wrapped functions.
