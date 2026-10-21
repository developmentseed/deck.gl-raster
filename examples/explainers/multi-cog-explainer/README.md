# MultiCOGLayer explainer

A step-by-step animation of how `MultiCOGLayer` draws bands stored at
different resolutions as one image. It follows one real Sentinel-2 tile
through the layer's pipeline: each band's own tile grid, the tiles that cover
it, stitching them into one texture per band, the UV transform that places the
tile inside each texture, and the shader sampling all three. It works both as
a talk prop and on its own.

This is an [explainer](../../README.md#explainers): its code was generated with
an LLM and hasn't been reviewed, so don't treat it as a pattern to copy. It
explains the mechanism rather than showing how to use `MultiCOGLayer`: instead
of the layer, it calls the same public building blocks the layer calls
(`selectSecondaryLevel`, `resolveSecondaryTiles`, `fetchTiles` and
`assembleTiles`), and it draws composites with `RasterLayer` and the
`CompositeBands` shader module.

## Steps

1. **Three files, one scene**: three bands of one scene as grayscale images,
   side by side. They cover the same ground with different numbers of pixels;
   the insets show the same 600 m square in each.
2. **One image**: the whole scene as `MultiCOGLayer` composites it, with
   shortwave infrared as red, red as green and coastal aerosol as blue. This
   picture is drawn by the same shader from each band's smallest overview; it
   shows the result, not the layer's tiling at this size.
3. **The primary grid**: the finest band's tile grid decides what gets drawn:
   11 x 11 tiles of 1024 px. The story follows tile (4, 4).
4. **Every band has its own tiles**: the 20 m and 60 m grids, and the tiles of
   each that cover tile (4, 4): one 20 m tile, and four 60 m tiles, because
   the 60 m grid doesn't line up with the 10 m one.
5. **Fetch**: the covering tiles move into the texture panel. They are all
   1024 or 256 px on a side, but cover very different ground.
6. **Stitch**: the four 60 m tiles become one 512 x 512 texture, so every band
   has exactly one texture.
7. **Where the tile lands**: each band's UV transform, drawn as the rectangle
   the tile covers in that band's texture: all of the 10 m texture, the
   top-left quarter of the 20 m one, and the middle ninth of the 60 m one.
8. **Sample**: a probe circles the tile while matching probes move in each
   texture, at `uv * scale + offset`. Bars show the three sampled values
   becoming red, green and blue.
9. **The tile on the map**: the composited tile flies back into its place in
   the scene.

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
| P | Open or collapse the side panel (keys and links) |

## Data

The Sentinel-2 L2A scene `S2C_18FXJ_20260406_0_L2A` (Torres del Paine, Chile,
2026-04-06), read live from the `sentinel-cogs` bucket on AWS:

```
https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/F/XJ/2026/4/S2C_18FXJ_20260406_0_L2A/
```

The scene is 109.8 km square, in UTM zone 18S (EPSG:32718). All bands are
UInt16 with nodata 0.

| Band | Drawn as | Pixel size | Size (px) | Tile size (px) | Overview read (px) |
|---|---|---|---|---|---|
| `B04.tif` (red) | green | 10 m | 10980 | 1024 | 687 |
| `B11.tif` (shortwave infrared) | red | 20 m | 5490 | 1024 | 687 |
| `B01.tif` (coastal aerosol) | blue | 60 m | 1830 | 256 | 229 |

It downloads about 5 MB: each band's smallest overview (1.6 MB) and the tiles
that cover tile (4, 4) at full resolution (3.5 MB). At startup it checks each
file's size, tile size, pixel size, origin and smallest overview against
`src/scene/constants.ts`, and stops with an error if any of them changed.

It needs a browser and GPU that can filter 16-bit textures (`r16unorm`), and
says so if yours can't.

Contains modified Copernicus Sentinel data 2026.

## Run

```bash
pnpm install
pnpm --recursive --filter='./packages/**' build   # the example imports the workspace packages from their dist/
pnpm --filter deck.gl-multi-cog-explainer-example dev
```
