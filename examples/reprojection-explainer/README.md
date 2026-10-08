# Reprojection explainer

A step-by-step animation of how deck.gl-raster reprojects a raster on the GPU
with a triangle mesh. It works both as a talk prop and on its own.

The source is CONUS land cover (NLCD) stored in an Albers equal-area
projection, where the 49th parallel is a curve. The image is cut into the mesh
that `@developmentseed/raster-reproject` really builds, each corner is moved
to its exact Web Mercator position, and the GPU stretches the image linearly
inside each triangle. The animation itself is drawn the same way: as textured
triangles whose texture coordinates the GPU interpolates. Nothing reprojected
is stored; every frame is drawn live from the source image.

Unlike the other examples, this one explains the algorithm rather than showing
how to use the library's layers: it draws with its own `TexturedTrianglesLayer`
instead of `RasterLayer`, and `src/scene/refinement.ts` reads
`RasterReprojector`'s private refinement queue to record each split.

## Steps

1. **The input image**: the image as stored, and the true 49°N line in Web
   Mercator.
2. **Two triangles**: the image is split into 2 triangles.
3. **Project the corners**: the 2 triangles fly over. Their corners land
   exactly, but the border sags far below the true line.
4. **Refine the mesh**: the library's refinement, replayed one split at a time.
   Each split lands where the straight-line guess is furthest off, and the new
   corner snaps to its exact position. A slider scrubs through the splits.
5. **Map each triangle**: every triangle of the final mesh flies into place.
6. **Done**: the edges fade, leaving the reprojected image.

Each step has a title and a description. The control bar at the bottom
appears when the mouse moves, and hides when it rests so it stays off the
screen while presenting from the keyboard.

## Keys

| Key | Action |
|---|---|
| → / Space / PageDown | Finish the current animation, or go to the next step |
| ← / PageUp | Previous step |
| R | Replay the current step |
| 1–6 | Jump to a step |
| D | Show or hide the step descriptions |
| F | Switch flight style (direct, or fly then snap) |
| H | Show the tuning panel |

## Data

`src/assets/nlcd-albers-2500.png` is the 2023 Annual NLCD land cover COG,
downsampled to 2500×1641 px (about 1.9 km per pixel) and colored with the
NLCD palette. Its georeferencing is hard-coded in `src/scene/nlcd.ts`,
because browsers ignore GDAL's `.aux.xml` sidecar.

## Run

```bash
pnpm install
pnpm build   # the example imports the workspace packages from their dist/
cd examples/reprojection-explainer
pnpm dev
```
