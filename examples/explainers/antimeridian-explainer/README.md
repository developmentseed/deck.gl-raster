# Antimeridian explainer

A step-by-step animation of how `@developmentseed/raster-reproject` keeps a
raster's mesh in one piece when it crosses the antimeridian (±180°). It
explains the `wrapX` option added to `RasterReprojector` in
[#673](https://github.com/developmentseed/deck.gl-raster/pull/673):
`snapToCopy` and `unwrapAlong` in `packages/raster-reproject/src/delatin.ts`.
It works both as a talk prop and on its own.

The source is geotiff-test-data's `antimeridian_UTM_60N.tif`: 42×42 pixels at
20 km, in UTM zone 60N, covering about 174°E–173°W and 48–56°N. Web Mercator x
wraps at 180°, so proj4 returns the image's east half on the far side of the
world. With `wrapX`, every vertex's x is moved by whole worlds to the copy
nearest a reference, which keeps the mesh continuous.

This is a copy of the [reprojection explainer](../reprojection-explainer),
which explains the mesh refinement itself. Like that one, it is an
[explainer](../../README.md#explainers): its code was generated with an LLM
and hasn't been reviewed, so don't treat it as a pattern to copy.
`src/scene/refinement.ts` reads `RasterReprojector`'s private refinement queue
to record each split, and replays `unwrapAlong` to record its samples.

## Steps

1. **The input image**: the image as stored, with the 180° meridian through
   it, and the whole Web Mercator world from −180° to +180°.
2. **Two triangles**: the image is split into 2 triangles.
3. **Project the corners**: proj4 returns every point in one world, so the
   two corners east of 180° land at −180°. Both triangles stretch across the
   whole world (465 px of error), and refining can't fix it.
4. **Snap to the nearest copy**: each seed corner is unwrapped by walking from
   the corner before it (`unwrapAlong`). Each sampled point (red, where proj4
   puts it) snaps to the copy nearest the point before it (green,
   `snapToCopy`). Then the view zooms in on the mesh, now in one piece with
   1.8 px of error.
5. **Refine the mesh**: the library's refinement, replayed one split at a
   time. Each new vertex snaps to the copy nearest its triangle's interpolated
   x (`_candidatesOutX`). A caption marks the splits whose vertex proj4
   returned a world away.
6. **Map each triangle**: every triangle of the final mesh flies into place.
7. **Done**: the mesh runs past +180°. The layer then clips it at 180°
   (`clipMeshToWorld`, outside `delatin.ts`).

## Keys

| Key | Action |
|---|---|
| → / Space / PageDown | Finish the current animation, or go to the next step |
| ← / PageUp | Previous step |
| R | Replay the current step |
| 1–7 | Jump to a step |
| D | Show or hide the step descriptions |
| F | Switch flight style (direct, or fly then snap) |
| H | Show the tuning panel |

## Data

`src/assets/utm60n-x24.png` is `antimeridian_UTM_60N.tif` coloured with a
viridis-like ramp and scaled up 24× with nearest neighbour, so its pixels stay
crisp under the texture's linear filtering. Its georeferencing is hard-coded
in `src/scene/utm60n.ts`. To regenerate it:

```bash
printf '1 68 1 84\n11 59 82 139\n21 33 145 140\n31 94 201 98\n42 253 231 37\n' > ramp.txt
gdaldem color-relief fixtures/geotiff-test-data/rasterio_generated/fixtures/antimeridian_UTM_60N.tif ramp.txt rgb.tif
gdal_translate -of PNG -outsize 1008 1008 -r nearest rgb.tif utm60n-x24.png
```

## Run

```bash
pnpm install
pnpm build   # the example imports the workspace packages from their dist/
cd examples/explainers/antimeridian-explainer
pnpm dev
```
