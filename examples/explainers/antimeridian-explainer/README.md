# Antimeridian explainer

A step-by-step animation of how deck.gl-raster meshes an image that crosses
the antimeridian (±180°). It follows one image through the steps `RasterLayer`
runs when its `_wrapX` prop is set, which `RasterTileLayer` (and so COGLayer)
does for every tile in Web Mercator: unwrap the image's corners, snap every
projected point to the right copy of the world, mesh it as usual, and cut the
mesh at the world's edge. It works both as a talk prop and on its own.

This is an [explainer](../../README.md#explainers): its code was generated with
an LLM and hasn't been reviewed, so don't treat it as a pattern to copy.

Every corner, sample, snapped point, split and cut on screen comes from the
library's own functions, called the way `RasterLayer` calls them:
`makeUnwrappedReprojectionFns` (with `unwrapAlong` and `nearestCopy` from
`@developmentseed/proj`), `RasterReprojector`, and `clipMeshToWorld`, with the
image projected into common space by `rescaleEPSG3857ToCommonSpace`, as
`RasterTileset2D` projects a tile. `makeUnwrappedReprojectionFns`,
`clipMeshToWorld` and the common-space rescale functions aren't exported from
`@developmentseed/deck.gl-raster`, so this app reaches them through a private
alias in its own `vite.config.ts` and `tsconfig.json`, pointing at the
package's built `dist/`. The package's exports
don't change. Like the reprojection explainer, `src/scene/refinement.ts` reads
`RasterReprojector`'s private refinement queue to record each split.

## Steps

1. **An image across 180°**: the image as stored, with the 180° meridian
   crossing it at a slant, and where it belongs on the map: at both edges.
2. **Two triangles**: the reprojector starts from two triangles.
3. **Project the corners**: proj4 returns every point in one copy of the world,
   so the west corners land at the map's east edge and the east corners at its
   west edge. Both triangles stretch across the world.
4. **Refining can't fix it**: a time-lapse of the reprojector refining that
   projection. It stops at its iteration cap, still hundreds of pixels off.
5. **Walk to the corners**: from the image's center, a walk toward each corner.
   Each sample moves to the copy of the world nearest the one before it, so the
   west corners come out past the world's west edge. From here, the map shows
   the whole world in a strip and the seam up close.
6. **Snap every point**: a probe sweeps the image. proj4's answer jumps a world
   as it crosses 180°; the point snapped to the copy nearest the blend of the
   unwrapped corners moves smoothly.
7. **Mesh as usual**: the library's refinement of the snapped projection,
   replayed one split at a time.
8. **Cut at the world's edge**: the triangles that cross -180° are cut along it,
   and the part past the edge moves one world over.
9. **On the map**: the map draws every copy of the world, so the two parts meet
   at the seam.

Each step has a title and a description. The control bar at the bottom
appears when the mouse moves, and hides when it rests so it stays off the
screen while presenting from the keyboard.

## Keys

| Key | Action |
|---|---|
| → / Space / PageDown | Finish the current animation, or go to the next step |
| ← / PageUp | Previous step |
| R | Replay the current step |
| 1-9 | Jump to a step |
| D | Show or hide the step descriptions |
| P | Open or collapse the side panel (keys, links and data) |

## Data

`antimeridian_UTM_60N.tif` from
[geotiff-test-data](https://github.com/developmentseed/geotiff-test-data), read
live from GitHub at the commit that added it:

```
https://raw.githubusercontent.com/developmentseed/geotiff-test-data/7d46e23/rasterio_generated/fixtures/antimeridian_UTM_60N.tif
```

It is a 42 x 42 test image in UTM zone 60N (EPSG:32660), 20 km per pixel,
covering about 174°E to 173°W and 48°N to 56°N, over the Aleutian Islands. Its
values run 1 to 42, one per column, colored here with a viridis-like ramp. At
startup the app checks its size, transform and CRS against
`src/scene/constants.ts`, and stops with an error if any of them changed.

## Run

```bash
pnpm install
pnpm --recursive --filter='./packages/**' build   # the example imports the workspace packages from their dist/
pnpm --filter deck.gl-antimeridian-explainer-example dev
```
