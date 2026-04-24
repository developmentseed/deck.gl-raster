# Zoom terminology in `deck.gl-raster`

Upstream deck.gl's `TileLayer` was designed for OSM / Web Mercator Quad
tilesets. In that world a single integer — the *zoom* — is simultaneously:

1. The level-of-detail (LOD) index into the tile pyramid (`z` in `z/x/y`).
2. The viewport's continuous zoom value (`viewport.zoom`) rounded to an int.

Both numbers are equal by convention because a Web Mercator tile at `z=12`
is sized to render at viewport zoom ≈ 12 at the equator. That convention
breaks down for this package:

- COG / GeoTIFF pyramids may have arbitrary resolutions between overviews;
  `overview[3]` is not necessarily "a tile at zoom 12".
- GeoZarr multiscale stacks pick resolutions per dataset; coarsest ≠ z=0 of
  Web Mercator.
- Non-Web-Mercator source CRSs (UTM, polar, WMO spherical, …) have no
  canonical zoom at all.

So `deck.gl-raster` treats the two senses of "zoom" as separate concepts,
and most of this file is to pin names to them.

## The two concepts

### Tileset z-index (`level.z`, `TileIndex.z`)

An integer index into `TilesetDescriptor.levels`. `0` is always the
coarsest level; `levels.length - 1` is the finest. Descriptors with a
single level only have `z = 0`.

- Returned from `Tileset2D.getTileIndices` as `TileIndex.z`.
- Used by `getParentIndex`, `getTileZoom`, and the traversal's `maxZ`
  / `childZ` arithmetic in `raster-tile-traversal.ts`.
- Has **no intrinsic relationship** to viewport units. A single-level zarr
  descriptor always returns tiles with `z = 0` regardless of where the
  user is panned.

### Viewport zoom (`viewport.zoom`)

A continuous `number` maintained by deck.gl on the active `Viewport`. In
Web Mercator this is the familiar "Google Maps zoom" — 0 is whole-world,
each +1 doubles the on-screen scale.

- Read from `this.context.viewport.zoom` in layer code or
  `opts.viewport.zoom` in a tileset.
- Drives the `minZoom` / `maxZoom` props on `TileLayer`, which compare
  against *this*, not against tileset z-index.
- Independent of the descriptor — a 1-level descriptor still experiences
  `viewport.zoom` ranging from 0 to 20+ as the user pans the map.

## How `minZoom` and `maxZoom` work for descriptor-driven layers

`RasterTileset2D` overrides `Tileset2D.getTileIndices` to drive LOD from a
`TilesetDescriptor` rather than OSM math. Two consequences:

1. **Tile z comes from `descriptor.levels`, not `viewport.zoom`.**
   `getTileIndices` still returns `TileIndex` objects, but `TileIndex.z`
   is an index into `descriptor.levels` (0 = coarsest). For a COG with 5
   overviews the range is 0–4. For a single-level zarr it's always 0.

2. **`minZoom` gates fetching by viewport zoom, explicitly.** We
   re-implement the `viewport.zoom < minZoom` check in
   `RasterTileset2D.getTileIndices` — `if (viewport.zoom < minZoom)
   return []` — because our overridden traversal would otherwise ignore
   it. Without that, a caller who sets `minZoom: 12` on a `ZarrLayer`
   over a global-extent single-level dataset would see tiles continue
   loading at viewport zoom 11, 10, 9 … because nothing would tell the
   traversal to stop.

   A `maxZoom` similarly clamps the tile z-index to
   `min(maxZoom, descriptor.levels.length - 1)`. There is no "overzoom"
   behavior (deck.gl's default tileset clamps z to `maxZoom` and keeps
   rendering when the viewport exceeds it; our equivalent is "render the
   finest descriptor level" which happens automatically).

## Why not `visibleMinZoom` / `visibleMaxZoom`

Deck.gl 9.3 adds `visibleMinZoom` and `visibleMaxZoom` on top of the
`min/maxZoom` pair. The intent is to decouple fetching from rendering:
`minZoom` says "don't fetch below this", `visibleMinZoom` says "don't
render below this", and — in OSM-style tiling — `extent` gives the
tileset a way to clamp `z` to a coarser LOD and keep showing tiles at
that level when underzoomed. The two props together let a layer pre-load
or persist tiles across the visible boundary.

That decoupling doesn't port to our descriptor-driven world. When our
`getTileIndices` returns `[]` (for any reason, including a `minZoom`
gate), deck.gl's `Tileset2D.updateTileStates` marks every cached tile
`isVisible = false`, and `TileLayer.filterSubLayer` early-outs on
`!tile.isVisible`. So returning `[]` kills both fetch and render, and
`visibleMinZoom` has no daylight to operate in. The mechanism upstream
uses to sidestep this — clamping the selected z to `minZoom` instead of
returning `[]` — depends on a dense OSM-style LOD stack. For a
single-level zarr there's no coarser z to clamp to, and for sparse COG
pyramids the coarsest real level may be many viewport-zoom steps away.

Rather than ship props that nominally exist but behave identically to
`minZoom` / `maxZoom`, `RasterTileset2D` does not honor
`visibleMinZoom` / `visibleMaxZoom`. Use `minZoom` / `maxZoom` instead.
If you want to stop rendering one viewport-zoom below where the layer
should "feel" loaded, lower `minZoom` to that level and accept the
extra load cost — the root-tile culling in `createRootTiles`
(`raster-tile-traversal.ts`) bounds how many tiles that actually
generates in practice.

## Recommended names

When reading or writing code in this area, prefer the disambiguating
names below. The shorthand "zoom" is ambiguous and should never stand
alone in API surface or comments:

- `tileZ` or `levelIdx` — integer index into `descriptor.levels`.
- `viewportZoom` — the continuous `viewport.zoom` value.

Deck.gl's prop names (`minZoom`, `maxZoom`) are fixed by the upstream
API and always refer to `viewportZoom`.

## Example: `examples/aef-mosaic`

- Dataset: single-level zarr at ~10 m/px native resolution.
- Descriptor has `levels.length = 1`, so `tileZ` is always 0.
- Caller sets `minZoom: 11` on the `ZarrLayer`.
- At `viewportZoom = 14`: viewport culling produces a handful of `z = 0`
  tiles; fetched, rendered.
- At `viewportZoom = 12`: viewport bounds are wider; more `z = 0` tiles
  are fetched and rendered.
- At `viewportZoom = 11`: more still. At native resolution each tile
  occupies roughly `tileWidth / 2` screen pixels, which looks
  coarse-but-acceptable.
- At `viewportZoom = 10`: `minZoom` gate trips → `getTileIndices`
  returns `[]`, cached tiles go `isVisible = false`, nothing draws.
  Cached tiles stay in memory in case the user zooms back in.
