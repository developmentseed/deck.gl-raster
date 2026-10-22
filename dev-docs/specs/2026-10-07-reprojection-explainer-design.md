# Reprojection Explainer Animation

- **Date:** 2026-10-07
- **Issues:** none
- **Status:** Implemented

## Problem

deck.gl-raster reprojects a raster by cutting it into a triangle mesh, placing
each triangle corner at its exactly reprojected position, and letting the GPU
stretch the image linearly inside each triangle. That idea is hard to get across
in a talk. Showing terrain-mesh work (Martini/Delatin) as an analogy did not
land in past talks. We need an animation that shows the mechanism directly, for
a talk on 2026-10-08.

## Goals

- Show, with the library's real mesh, that:
  1. one linear stretch per triangle cannot follow a curved warp,
  2. adding corners where the error is largest makes the result converge, and
  3. the result is the source image's triangles each drawn into their new place.
- Run live in a browser and be driven from the keyboard during the talk.
- Render with the same GPU mechanism it explains: textured triangles whose
  texture coordinates the GPU interpolates linearly.
- Keep the code clean enough to merge later as a regular example.

## Non-goals

- Per-tile meshes (what `COGLayer` really builds), the globe view, and loading
  the COG at runtime.
- General interactivity: no panning or zooming.

(A docs gallery card was first a non-goal; it was added once the example was
headed for merge.)

## Source data

`nlcd-albers-2500.png` from the main checkout: CONUS NLCD land cover, 2500×1641
RGBA, in the NLCD Albers CRS (`+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5
+lat_2=45.5 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`). Its geotransform is
`[-2415585, 1920, 0, 3314805, 0, -1919.5612431444242]` (GDAL order). Browsers
ignore the `.aux.xml` sidecar, so the CRS and geotransform are constants in code.
The alpha channel is a clean nodata mask (0 or 255), and all four corners are
nodata.

Measured facts this design relies on (whole image as one mesh, Web Mercator
target, error in source pixels):

| Mesh | Triangles | Max error |
|---|---|---|
| Seed (2 triangles) | 2 | 260.9 px (~500 km) |
| `maxError` 8 px | 100 | 8 px |
| `maxError` 4 px | 194 | 4 px |
| `maxError` 2 px | 392 | 2 px |
| Library default 0.125 px | 6,001 | 0.125 px |

With the 2-triangle seed, the US–Canada border sags about 507 km below the true
49th parallel in Web Mercator. `RasterReprojector.refine()` adds exactly one
vertex per call, is deterministic, and the mesh at any threshold is a prefix of
the same sequence of steps. So the animation can replay the real refinement
without changing the package.

## Storyboard

The right arrow key advances one step; the left arrow key goes back.

0. **Start.** Left panel: the Albers image, with the full image rectangle
   faintly visible and 49°N drawn as a curve. Right panel: an empty Web Mercator
   frame with the true 49°N as a straight dashed line.
1. **Cut.** A diagonal splits the image into 2 triangles.
2. **First attempt.** The 2 triangles fly to the right panel. Their corners
   land exactly, but the border sags far below the dashed line. A red dot marks
   the worst point (the GPU's straight-line guess) and a green dot marks where
   that point really belongs. A counter reads "2 triangles · max error 261 px
   (≈ 501 km)".
3. **Refine.** Replay `refine()` on both panels in sync. Each step:
   - highlight the triangle with the largest error and show the red dot,
   - cut it (new edges appear on both panels),
   - on the right, move the new corner from the guess to its exact position,
     which pulls the image into place.

   Early steps play slowly; later steps speed up. Stop at the final mesh
   (default `maxError` 4 px, 194 triangles). The counter updates throughout.
4. **Final fly-over.** The right panel clears to faint outlines of the final
   triangles' target "slots". Every triangle flies from the left panel into its
   slot, eastmost first so none overtake another.
5. **Result.** The edges fade, leaving the clean reprojected image. A caption
   notes the library's default is 6,001 triangles for this image.

The left panel always shows the source image (the texture) and the current
mesh. Flying triangles are copies drawn from it, which matches what the GPU does:
the texture never changes, only where each triangle is drawn.

**Flight style is decided live.** Two styles, switchable with a key:

- **Direct:** each triangle moves and reshapes into its slot in one motion.
- **Fly, then snap:** the pieces fly over unchanged and land as a copy of the
  source rectangle, scaled to the target footprint's width and centred on it.
  Then every corner moves to its exact position at once, so the warp is seen
  in place, separate from the motion.

## Design

### Layout

One `OrthographicView` over a fixed 1920×1080 "slide" coordinate space, with
y pointing down. The view's zoom fits that space to the window. Two panels,
each about 820 slide units wide, sit side by side. The source panel maps image
pixels linearly into the left rectangle. The target panel maps EPSG:3857 metres
into the right rectangle, scaled to the reprojected footprint's bounding box.
All positions are small slide-unit numbers, so float32 is precise enough and no
fp64 handling is needed.

### Mesh and refinement recording

`RasterReprojector` is built from four functions: pixel ↔ Albers through the
geotransform, and Albers ↔ EPSG:3857 through proj4. Width and height get the
same `+1` that `RasterLayer` uses. A recorder calls `refine()` until the final
`maxError` and saves one snapshot per step:

- the triangle indices after the step,
- the split triangle and the candidate point (read from the reprojector's
  private `_queue`, `_candidatesUV` and `_errors` fields with a cast; no
  package change),
- the new vertex's guess position (the split triangle's linear interpolation
  at the candidate) and its exact position, and
- the max error after the step.

### Texture

An offscreen canvas holds an opaque "sheet" colour, the PNG drawn on top, and
the 49th parallel baked in. Because the line is part of the texture, it warps
exactly as the GPU warps the image. That is how the curved border visibly
fails to straighten with 2 triangles and lines up once refined. The sheet
colour fills the nodata areas, so the whole image rectangle stays visible as
it warps, and an opaque texture avoids alpha fringes at nodata edges. The
texture is uploaded once with mipmaps and linear filtering, and shared by
every mesh layer.

### Rendering

A small custom layer, `TexturedTrianglesLayer`, draws de-indexed triangles
(3 vertices per triangle, so triangles can separate in flight). Its per-vertex
attributes are position, texture coordinate, barycentric coordinate (to draw
edges in the fragment shader) and a tint (to highlight triangles). It knows
nothing about animation; positions are recomputed in JS each frame and
re-uploaded, which is cheap at a few hundred triangles. Overlays use stock
deck.gl layers:

- the dashed 49°N line and footprint outline in the target panel,
- the faint target slots,
- the red and green dots and the gap line between them.

### Choreography

Each step is a pure function from elapsed time to a frame description: the
positions and tints for each mesh, overlay opacities, and counter text. This
makes the arrow keys, replay and unit tests straightforward. A
`requestAnimationFrame` loop evaluates the current step and calls
`deck.setProps`. React renders only the HTML overlay (panel titles, counter,
captions).

### Controls

| Key | Action |
|---|---|
| → / Space / PageDown | If the step is still animating, jump to its end; otherwise go to the next step |
| ← / PageUp | Previous step, shown in its end state |
| R | Replay the current step |
| 1–6 | Jump to a step |
| D | Show or hide the step descriptions |
| F | Toggle flight style |
| H | Toggle a hidden tuning panel (final `maxError`, speeds) |

### Titles, descriptions and on-screen controls

Added after the first review, so the example also works for people loading it
on their own, without a narrator:

- Every step has a title across the top ("3 · Project the corners") and a
  description under the panels. A "Descriptions" checkbox (and the D key)
  hides the descriptions; the choice is remembered in `localStorage`. The
  numbers in the descriptions (the 2-triangle error, the final threshold, the
  library's default triangle count) are filled in from the recorded
  refinement.
- A control bar at the bottom has previous and next buttons, clickable step
  dots, replay, and the checkbox. It appears when the pointer moves and fades
  out after 2.5 s of rest, so it stays off the projector while presenting
  from the keyboard.
- The refinement step has a slider with one position per split. Dragging it
  pauses on that split's highlight (the `Player` gained `seek` and `resume`),
  and the replay button becomes a play button until playback resumes.

### Where it lives

An explainer (its code is unreviewed) at
`examples/explainers/reprojection-explainer` on branch
`kyle/reprojection-explainer`, with the standard scaffold (Vite, React,
`deck.gl-raster-examples-shared`). It uses the imperative `Deck` class, so no
new `@deck.gl/react` dependency. It adds `@luma.gl/engine` for the custom
layer's `Model`, `proj4`, and workspace `@developmentseed/raster-reproject`.
The PNG is copied into the example's sources.

## Testing

- **Unit tests (vitest)** for the pure parts:
  - image corners reproject to the known lon/lat,
  - the recorder reproduces the measured counts (2 triangles at 260.9 px;
    194 triangles at 4 px),
  - de-indexing,
  - flight frames equal the source positions at the start and the target
    positions at the end,
  - the stagger order.
- **Typecheck and Biome**, as in CI.
- **Visual check** of every step in headed Chrome, with screenshots, before
  calling each stage done.

## Open questions, to settle while watching it

- Flight style: direct, or fly then snap.
- Final mesh density (4 px default; 8 px is sparser and easier to read).
- Timing, colours, and wording of labels and captions.
- Whether the dashed footprint outline shows from the start or from step 2.
