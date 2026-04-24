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
- Drives visibility / fetch gates: `minZoom`, `maxZoom`, `visibleMinZoom`,
  `visibleMaxZoom` on `TileLayer` compare against *this*, not against
  tileset z-index.
- Independent of the descriptor — a 1-level descriptor still experiences
  `viewport.zoom` ranging from 0 to 20+ as the user pans the map.

## How deck.gl's upstream props behave

Upstream `TileLayer` defines four numeric props that sound like they all
mean the same thing. In deck.gl 9.3 their semantics are:

| Prop | Compared against | Controls |
|---|---|---|
| `minZoom` | `viewport.zoom` | **Fetching.** If `viewport.zoom < minZoom`, the tileset's `getTileIndices` returns `[]` → no new tile fetches. Already-cached tiles are untouched and may still render. |
| `maxZoom` | `viewport.zoom` | **Fetching.** Deck.gl's default tileset clamps the selected z to `maxZoom` when the viewport exceeds it (overzoom — displays the finest-available level). Our `RasterTileset2D` instead clamps to `min(maxZoom, levels.length - 1)`. |
| `visibleMinZoom` | `viewport.zoom` | **Rendering.** If `viewport.zoom < visibleMinZoom`, `TileLayer.renderLayers()` returns `[]`. Cached tiles are not deleted, just hidden. |
| `visibleMaxZoom` | `viewport.zoom` | **Rendering.** Mirror of `visibleMinZoom` on the other end. |

Note that `min/maxZoom` (fetching) and `visibleMin/MaxZoom` (rendering)
are independent. A common pattern is `minZoom < visibleMinZoom` to pre-load
one or two zoom levels before the user reaches the visible band, or
`minZoom > visibleMinZoom` so already-cached tiles keep showing a zoom
level after the user zooms below the fetch threshold.

## What this package does differently

`RasterTileset2D` (our subclass of `Tileset2D`) overrides `getTileIndices`
to drive LOD selection from a `TilesetDescriptor` rather than OSM math.
Two consequences:

1. **Tile z comes from `descriptor.levels`, not `viewport.zoom`.**
   `getTileIndices` still returns `TileIndex` objects, but `TileIndex.z`
   is an index into `descriptor.levels` (0 = coarsest). For a COG with 5
   overviews the range is 0–4. For a single-level zarr it's always 0.

2. **Viewport zoom gates are applied explicitly.** We re-implement the
   four fetch/render gates in `RasterTileset2D.getTileIndices`
   (`raster-tileset-2d.ts`) against `opts.viewport.zoom` and
   `this.opts.visibleMin/MaxZoom`, because our overridden traversal would
   otherwise ignore them. This is the block that does
   `if (viewport.zoom < minZoom) return []`. Without it, a user who sets
   `minZoom: 12` on a `ZarrLayer` would see tiles continue loading at
   viewport zoom 11, 10, 9, … because nothing would tell the traversal to
   stop.

## Recommended names

When reading or writing code in this area, prefer the disambiguating
names below. The shorthand "zoom" is ambiguous and should never stand
alone in API surface or comments:

- `tileZ` or `levelIdx` — integer index into `descriptor.levels`.
- `viewportZoom` — the continuous `viewport.zoom` value.

Deck.gl's prop names (`minZoom`, `visibleMinZoom`, etc.) are fixed by the
upstream API and always refer to `viewportZoom`.

## Example: `examples/aef-mosaic`

- Dataset: single-level zarr at ~10 m/px native resolution.
- Descriptor has `levels.length = 1`, so `tileZ` is always 0.
- User sets `minZoom: 12` and `visibleMinZoom: 11` on the `ZarrLayer`.
- At `viewportZoom = 14`: viewport culling produces a handful of `z = 0`
  tiles; fetched, rendered.
- At `viewportZoom = 12`: viewport bounds are wider; more `z = 0` tiles
  are fetched and rendered.
- At `viewportZoom = 11`: `minZoom` gate trips → `getTileIndices` returns
  `[]`, no new fetches. But tiles cached from 12+ remain in
  `tileset.tiles` and `renderLayers()` still draws them
  (`visibleMinZoom` permits 11).
- At `viewportZoom = 10`: `visibleMinZoom` gate trips → `renderLayers()`
  returns `[]`, nothing drawn. Cached tiles stay in memory in case the
  user zooms back in.
