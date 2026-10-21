# MultiCOGLayer Explainer: Anatomy of a Tile

- **Date:** 2026-10-20 (revised 2026-10-21)
- **Issues:** #757 (background: #411, #580, #651, #755)
- **Status:** Draft

## Problem

`MultiCOGLayer` composites bands stored at different resolutions, such as
Sentinel-2's 10 m, 20 m and 60 m bands, into one image, tile by tile, on the
GPU. That is what makes it useful, and it is hard to picture:

- each band is its own COG, with its own tile grid and overviews;
- one tile of the finest band (the primary tile) is covered by a different set
  of tiles in every other band;
- those covering tiles are stitched into one texture per band; and
- a UV transform tells the shader where the primary tile sits inside each
  band's texture.

This machinery is easy to get wrong: three PRs have tripped over it (#411,
#651, #580), and the dev doc's reasoning about it was wrong for months. The
debug overlay prints the numbers (UV transform, stitched size) but never shows
the textures they apply to.

We need an explainer that shows the mechanism directly. It serves maintainers
and contributors reasoning about changes to this code, conference talks, and
end users and stakeholders asking how the layer works.

## Goals

- Follow one real tile through `MultiCOGLayer`'s pipeline and show, with the
  library's real numbers, that:
  1. each band has its own tile grid, so the tiles covering one primary tile
     differ per band;
  2. the covering tiles are stitched into one texture per band;
  3. a UV transform places the primary tile inside each band's texture; and
  4. the shader samples every band at the same spot through its UV transform,
     which is how bands at different resolutions line up.
- Compute every tile choice, size and UV transform with the public functions
  `MultiCOGLayer` itself calls (`selectSecondaryLevel`, `resolveSecondaryTiles`,
  `fetchTiles`, `assembleTiles`), so the explainer can't drift from the layer.
- Draw the final composite with the library's `CompositeBands` shader module,
  from the same textures the explainer shows. This is the same principle as
  the reprojection explainer, which draws with the mechanism it explains.
- Work as a talk prop (driven from the keyboard, legible on a projector) and on
  its own (a title and a description for every step).

## Non-goals

- Edge tiles, padding and the `boundless` option. The explainer follows an
  interior tile, so nothing is clipped, and the story stays on mixing
  resolutions.
- Reprojection and the mesh: the reprojection explainer covers them. This
  explainer works in the scene's own CRS (UTM) and treats the map as flat.
- How the layer picks overview levels as you zoom. The explainer follows one
  tile at full resolution and mentions overviews in passing.
- General interactivity: no panning, zooming, or choosing a scene or tile.
- A debugging tool for arbitrary datasets. That's the debug overlay's job.
- The globe view and WebGPU.

## Anti-goals

- For the story's tile (steps 2-8), any tile choice, size, rectangle or sample
  position that is drawn by hand instead of coming from the real functions.
  (Step 1's whole-scene picture is a stated simplification; see the
  storyboard.)
- Reading `MultiCOGLayer`'s private state. The explainer calls the same public
  building blocks the layer calls, and never instantiates the layer to inspect
  it.

## Source data

The sentinel-2 example's default scene, Sentinel-2 L2A
`S2C_18FXJ_20260406_0_L2A` (Torres del Paine, Chile, 2026-04-06), from the
`sentinel-cogs` AWS bucket
(`https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/F/XJ/2026/4/S2C_18FXJ_20260406_0_L2A/<band>.tif`).
CRS EPSG:32718 (UTM 18S), origin (600000, 4400020), 109.8 km square. All bands
are UInt16 with nodata 0.

| Band | Role in the explainer | Pixel size | Size (px) | Block | Overviews |
|---|---|---|---|---|---|
| B04 (red) | primary | 10 m | 10980 | 1024 | 5490, 2745, 1373, 687 |
| B11 (SWIR 1) | secondary | 20 m | 5490 | 1024 | 2745, 1373, 687 |
| B01 (coastal aerosol) | secondary | 60 m | 1830 | 256 | 915, 458, 229 |

The overviews use smaller blocks than the full-resolution levels: 512 px for
B04 and B11, and 128 px for B01.

B01's 256 px blocks matter: a 60 m tile is 15.36 km on the ground, while a
10 m tile is 10.24 km. The two grids don't line up, so a 10 m tile can straddle
four 60 m tiles. (The 20 m grid, at 20.48 km, nests exactly: each 20 m tile
holds 2 x 2 tiles of 10 m.)

### The tile

Measured with the real `resolveSecondaryTiles`. The primary is B04 at full
resolution, tile (4, 4), well inside the scene, so no band is clipped. It
covers pixels 4096-5120 in both directions. In UTM, that is x 640960-651200 and
y 4348820-4359060.

| Band | Covering tiles | Stitched texture | UV transform `[offsetX, offsetY, scaleX, scaleY]` |
|---|---|---|---|
| B04, 10 m | (4, 4) | 1024 x 1024 | `[0, 0, 1, 1]` |
| B11, 20 m | (2, 2) | 1024 x 1024 | `[0, 0, 0.5, 0.5]`: the top-left quarter |
| B01, 60 m | (2, 2), (3, 2), (2, 3), (3, 3) | 512 x 512 | `[0.3333, 0.3333, 0.3333, 0.3333]`: the middle ninth |

Why this tile: the 10 m tiles in columns and rows 1, 4 and 7 cross a 60 m tile
boundary both ways, so each needs a 2 x 2 stitch of 60 m tiles. All nine such
interior tiles tell the same story: a quarter of one 20 m tile, and the
middle ninth of four 60 m tiles. (4, 4) looks the best of them. In the colors
below it shows a snowy ridge with glaciers, a dark lake and bare rock, with
hard edges where the 60 m band's softness shows. (7, 7), a meandering river
on a plain, is the runner-up.

### Colors

The composite maps one band per resolution: red = B11 (20 m), green = B04
(10 m), blue = B01 (60 m). With true color (all 10 m) nothing would mix, and
with this mapping the 60 m band's softness shows up in one channel, which is
the point. The per-band rescale is the builder's call, tuned by eye.

## Storyboard

The right arrow key advances one step; the left arrow key goes back.

0. **Three files, one scene.** The three bands as grayscale images side by
   side: same footprint, labeled with pixel size and dimensions (10980,
   5490, 1830 px). An inset zooms into one spot so the different pixel sizes
   are visible.
1. **One image.** The whole scene composited by the same shader the layer
   uses, from each band's smallest overview. Caption: these three files,
   drawn as one image. How? This is a picture of the result, not the
   layer's actual tiling at this size: which level the layer would draw
   depends on the screen, and at this size it would draw several tiles with
   seams the story hasn't introduced yet.
2. **The primary grid.** The finest band sets the tile grid: 11 x 11 tiles of
   1024 px at full resolution, drawn over the scene. Tile (4, 4) is
   highlighted.
3. **Every band has its own tiles.** The 20 m grid (20.48 km tiles) and the
   60 m grid (15.36 km tiles) appear in their own colors. The tiles covering
   the highlighted tile light up: one 20 m tile and four 60 m tiles. The 60 m
   grid visibly doesn't line up with the 10 m grid.
4. **Fetch.** The covering tiles lift out of the scene into the texture
   panel: one 10 m tile, one 20 m tile and four 60 m tiles. Every tile is
   1024 or 256 px on a side, but they cover very different ground. A 20 m tile
   covers four times the area of a 10 m tile, and a 60 m tile 2.25 times.
5. **Stitch.** The four 60 m tiles slide together into one 512 x 512 texture.
   Each band now has exactly one texture: 1024 x 1024, 1024 x 1024 and
   512 x 512.
6. **Where the tile lands.** On each texture, a rectangle shows what the 10 m
   tile covers: all of the 10 m texture, the top-left quarter of the 20 m
   one, and the middle ninth of the 60 m one. Labels give each rectangle's
   offset and scale, the UV transform's four numbers.
7. **Sample.** A probe moves across the 10 m tile while a matching crosshair
   moves in each texture, at `uv * scale + offset`. Three bars show the
   sampled values becoming red, green and blue. One sweep across the tile
   crosses 1024 texels of the 10 m texture, 512 of the 20 m one and about 170
   of the 60 m one, and the GPU interpolates between them.
8. **The tile on the map.** The composited tile, drawn by the GPU with
   `CompositeBands` from the three textures, settles back into its place over
   step 1's whole-scene picture. Its eight full-resolution neighbors would
   cost about 12 MB more for the 10 m band alone. A caption points to the
   reprojection explainer for how the tile is then meshed onto the map.

## Design

The app copies the reprojection explainer's structure
(`examples/explainers/reprojection-explainer`) and changes what it draws.
Copying rather than sharing code keeps that explainer untouched; both are
unreviewed code (see `examples/README.md#explainers`).

### Layout

One `OrthographicView` (with `flipY`) over a fixed 1920 x 1080 slide,
letterboxed to the window, with the HTML title and description laid out in
slide units, all as in the reprojection explainer. Two panels:

- **Scene panel** (left): the whole 109.8 km scene, with UTM metres mapped
  linearly into the panel. Tile grids, the highlighted tile and the covering
  tiles are drawn here.
- **Texture panel** (right): one slot per band, for the fetched tiles, the
  stitched textures and the UV rectangles. Slot arrangement (stacked or side
  by side) is settled while watching it. In step 6, labels must give each
  rectangle's offset and scale as fractions of its texture's width and
  height, so they read as the UV transform's four numbers.

The sample bars in step 7 sit under the texture panel.

### Data loading

The data is fetched live; bundling it for offline talks isn't needed. At
startup, behind a loading screen, the app:

1. opens the three COGs with `GeoTIFF.fromUrl` from `@developmentseed/geotiff`
   and checks that their sizes, tile sizes and georeferencing match the
   Source data table, failing with a clear message if the files have changed;
2. builds an `AffineTilesetLevel` for each band's full-resolution level from
   the image's transform, size and tile size (public API; this is what
   `MultiCOGLayer` does internally);
3. picks each secondary band's level with `selectSecondaryLevel` and resolves
   tile (4, 4)'s covering tiles with `resolveSecondaryTiles`;
4. fetches the covering tiles once with `fetchTiles`, with the same options
   the layer uses, and stitches them with `assembleTiles`; and
5. fetches each band's coarsest overview for the scene panel and step 1, and
   stitches each into one texture with `assembleTiles`. Each coarsest overview
   is 2 x 2 tiles: 687 px on 512 px blocks for 10 m and 20 m, and 229 px on
   128 px blocks for 60 m.

Nothing is fetched after step 0 appears, so stepping never waits on the
network. Measured compressed sizes:

- the 10 m tile: 1.65 MB
- the 20 m tile: 1.52 MB
- the four 60 m tiles: 0.35 MB
- the three coarsest overviews: 1.58 MB

That is about 5.1 MB in all. `@developmentseed/geotiff` doesn't cache tile
reads, so nothing should be fetched twice.

### Rendering

- **Band images and textures** (grayscale, steps 0 and 3-7) are `BitmapLayer`s
  of canvases made from the UInt16 arrays with a per-band contrast stretch.
  Pixel-level views (step 0's inset) use nearest filtering, so pixel sizes
  are visible.
- **Grids, tile outlines, UV rectangles, the probe and crosshairs** use stock
  layers (`PathLayer`, `PolygonLayer`, `ScatterplotLayer`).
- **Composites** (steps 1 and 8) are drawn by deck.gl-raster's `RasterLayer`
  with the same pipeline `MultiCOGLayer` uses: `CompositeBands` (with
  `buildCompositeBandsProps`) followed by `LinearRescale`. Its inputs are
  GPU textures made from the same arrays, uploaded the way the layer uploads
  them (`r16unorm` for UInt16). The `reprojectionFns` map tile pixels
  linearly into slide units, with a cartesian coordinate system, so the mesh
  is two triangles and nothing is reprojected. Step 1's whole-scene composite
  uses each band's stitched coarsest overview. Each covers the whole scene,
  so every UV transform is `[0, 0, 1, 1]`. Even that picture mixes 687 px and
  229 px textures. The builder should first verify that `RasterLayer` works
  in the slide view. If it doesn't, the fallback is a small custom layer that
  runs the `CompositeBands` shader module on one quad.

### Animation

As in the reprojection explainer:

- Each step is `{ id, title, description, durationMs, frame(timeMs) }`, where
  `frame` is a pure function from elapsed time to a declarative draw list.
- A `Player` holds the current step and its start time.
- A `requestAnimationFrame` loop turns the current frame into layers and
  calls `deck.setProps`.
- React renders only the HTML.
- Easing and interpolation helpers are copied over.

This explainer's draw list needs different primitives (bitmaps with bounds
and opacity, polygons, paths, dots and composites), so its `Frame` type is its
own.

Movement that carries meaning:

- In step 4, the covering tiles fly from their place over the scene into the
  texture panel.
- In step 5, the four 60 m tiles slide together.
- In step 8, the composited tile flies back to its place over the scene.

### Controls

The reprojection explainer's presenter keys, without its scenario-specific
ones:

| Key | Action |
|---|---|
| → / Space / PageDown | If the step is still animating, jump to its end; otherwise go to the next step |
| ← / PageUp | Previous step, shown in its end state |
| R | Replay the current step |
| 1-9 | Jump to steps 0-8 |
| D | Show or hide the step descriptions |
| P | Open or close the side panel (key list and links) |

Also copied: the auto-hiding control bar (previous, next, step dots,
replay), the focus handling that keeps a presentation clicker working, and
the descriptions setting in `localStorage` (under its own key).

### Where it lives

`examples/explainers/multi-cog-explainer`, on branch `kyle/multi-cog-explainer`:

- **Scaffold:** package name `deck.gl-multi-cog-explainer-example`, Vite
  `base` `/deck.gl-raster/examples/multi-cog-explainer/`, and the standard
  scripts, tsconfig and `ExampleProvider`.
- **Dependencies:** `@deck.gl/core`, `@deck.gl/layers`, `@luma.gl/core`,
  `react`, `react-dom` and `@chakra-ui/react` (for `ExampleProvider`), plus
  workspace `@developmentseed/geotiff`, `@developmentseed/deck.gl-raster` and
  `deck.gl-raster-examples-shared`.
- **README:** opens with the explainer disclaimer (LLM-generated,
  unreviewed), then covers the steps, keys, data provenance and how to run it.
- **Docs card:** an entry in `explainerExamples` in
  `docs/src/pages/examples/index.tsx`, plus a card image, once it's headed for
  merge.

## Testing

- **Unit tests (vitest, node environment, as in the reprojection explainer)**
  for the pure parts:
  - the chosen tile's covering tiles, stitched sizes and UV transforms equal
    the table above. These are computed through the real functions, from
    `AffineTilesetLevel`s built from the Source data constants, with no
    network. This guards the explainer against drift in the library.
  - each step's frame function at its start and end;
  - the probe's mapping from a primary UV to each texture's texel;
  - the slide layout.
- **Typecheck and Biome**, as in CI.
- **Visual check** of every step in headed Chrome, with screenshots, before
  calling each stage done.

## Open questions

To settle while watching it: timing, colors, wording, whether the textures
stack vertically or sit side by side, and the probe's path.

## Decisions

Decided with Kyle (2026-10-21):

- The data is fetched live, not bundled.
- Edge tiles, padding and `boundless` stay out of the story, so there is no
  coda about #651 and #411.

Decided while drafting, for Kyle to check:

- Scene 18FXJ, tile (4, 4), bands B04, B11 and B01, colored green, red and
  blue.
- Step 1 is a stated simplification (each band's smallest overview through
  the same shader), and the "nothing drawn by hand" rule covers the story's
  tile.
- Step 8 settles the tile over step 1's picture instead of loading
  full-resolution neighbors.
- The reprojection explainer's player, HUD and controls are copied, not
  shared.
- Composites are drawn with `RasterLayer` and `CompositeBands` in the slide
  view, verified first, with a custom quad layer as the fallback.
