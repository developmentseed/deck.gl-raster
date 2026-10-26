# Rasters over terrain (experimental)

Cloud-Optimized GeoTIFFs draped over 3D terrain with deck.gl's experimental
[`TerrainExtension`][terrain-extension].

The COGs and the terrain don't share a tile grid. Each COG is tiled in its own
projection: UTM zone 13N for nine NAIP aerial images around Pikes Peak (the
default view, at 1.5x vertical exaggeration), the Swiss LV95 grid
(EPSG:2056), or a 1962 USGS map's NAD27 polyconic projection. The elevation
comes from [Terrain Tiles], which are Web Mercator XYZ tiles.

> [!WARNING]
> This example is experimental. Its code is LLM-generated and unreviewed, and
> it may change substantially or be withdrawn.

[terrain-extension]: https://deck.gl/docs/api-reference/extensions/terrain-extension
[Terrain Tiles]: https://registry.opendata.aws/terrain-tiles/

To view locally:

```bash
pnpm install
pnpm build
cd examples/experimental/cog-terrain
pnpm dev
```

## How it works

```ts
import { MapView, TerrainController } from "@deck.gl/core";
import type { TerrainExtensionProps } from "@deck.gl/extensions";
import { _TerrainExtension as TerrainExtension } from "@deck.gl/extensions";
import { TerrainLayer } from "@deck.gl/geo-layers";
import type { COGLayerProps } from "@developmentseed/deck.gl-geotiff";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";

const view = new MapView({ controller: { type: TerrainController } });

const terrain = new TerrainLayer({
  elevationData:
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  elevationDecoder: { rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768 },
  maxZoom: 15, // the deepest Terrain Tiles zoom
  operation: "terrain+draw",
  pickable: true,
});

const cogProps: COGLayerProps & TerrainExtensionProps = {
  id: "cog",
  geotiff: "https://example.com/image.tif",
  extensions: [new TerrainExtension()],
  terrainDrawMode: "drape",
  zRange: [500, 2100], // meters; the example measures it from the terrain
};
const cog = new COGLayer(cogProps);
```

- `operation: "terrain+draw"` makes the `TerrainLayer` the surface that layers
  with the extension are draped over. `TerrainLayer` doesn't set it by default.
- `terrainDrawMode: "drape"` is required. Left unset, the extension picks
  `"offset"` for deck.gl-raster's mesh layer, because that layer is built on
  `SimpleMeshLayer`. Offset mode lifts only the reprojection mesh's vertices
  onto the terrain, so ridges cut through the image.
- `zRange` is the lowest and highest terrain elevation under the COG, in
  meters. `COGLayer` selects its tiles for that range of heights instead of for
  sea level. Without it, tiles near the camera can be missing over high
  terrain, because the terrain lifts them into view. The example doesn't
  hard-code it: as each terrain tile loads, `TerrainLayer`'s `onTileLoad`
  reports the tile mesh's `header.boundingBox`, and the example widens the
  range to include it. `TerrainLayer` sets its own `zRange` from the same
  field, in `onViewportLoad`.
- `TerrainController` moves the camera's target toward the ground under the
  center of the view as you move, so the camera rises and falls with the
  terrain. It finds the ground by picking, so the `TerrainLayer` must be
  pickable.
- The `TerrainLayer`'s `extent` is the union of the COGs' WGS84 bounds, which
  `COGLayer`'s `onSourceLoad` reports once a COG's header loads. Terrain
  tiles then load only where they overlap the COGs' bounds. The example
  doesn't create the `TerrainLayer` until the first COG reports its bounds.
- Tiles load whole, so a `ClipExtension` on the `TerrainLayer` also stops it
  drawing outside those bounds. `TerrainLayer`'s meshes are in Web Mercator
  common space, so `clipBounds` is too (converted with `lngLatToWorld`), and
  `clipByInstance: false` clips by pixel rather than by each tile mesh's
  anchor. The clip box is axis-aligned, so gray terrain can still show along
  the edges of a COG that isn't, and in a COG's nodata areas.
- `COGLayerProps` doesn't include extension props, so the props are built
  separately. An inline object literal fails TypeScript's excess property
  check on `terrainDrawMode`.

In drape mode, deck.gl never draws the COG directly. For each terrain tile it
keeps a texture covering that tile's longitude/latitude bounds. It renders into
that texture every COG tile in view whose bounds overlap the terrain tile, using
a flat, top-down Web Mercator view, and deck.gl-raster reprojects each COG tile
on the GPU as usual. The terrain mesh then samples that texture.

The only link between the two tile grids is that overlap test. It uses the
WGS84 bounds that deck.gl-raster computes for every COG tile, so the COG can be
in any projection and tiled any way.

The vertical exaggeration slider multiplies the Terrarium decoder's scales and
offset, so every height scales by the same factor. `TerrainLayer` then reloads
its tiles, and the example rescales the measured `zRange` rather than
measuring it again. The decoder is memoized: `TerrainLayer` compares it by
reference, and a new one reloads every terrain tile.

`TerrainController` doesn't move the camera when the terrain rises, so at a
higher exaggeration the camera could end up inside a mountain. The example
raises the camera's height above sea level by the same factor, which keeps it
above the ground, and gives the view a new controller there. Its first pick
moves its target to the ground without moving the camera. A lower exaggeration
leaves the camera where it is: lowered too, it would be nearer the ground, and
that first pick could zoom it past `maxZoom`. A new scene starts at the
default exaggeration, which its start view is set for.

NAIP has four bands: red, green, blue and near-infrared. `COGLayer`'s default
pipeline would draw the fourth band as alpha, so the NAIP options pass their
own `getTileData` and `renderTile` (in `src/naip.ts`), as the
[NAIP mosaic example](../../naip-mosaic/) does. They upload all four bands and
set alpha to 1, in true color or as false-color infrared (near-infrared as
red, red as green, green as blue). The two options draw the same COGs, so
switching between them keeps the camera and terrain and only re-renders the
COG tiles.

## Limitations

- **The terrain tiles, not the COG, set the resolution.** Each terrain tile's
  texture is at most 2048 px wide, at most two zoom levels finer than the
  terrain tile. Its size is fixed when the terrain tile first appears and
  ignores the screen's `devicePixelRatio`, so zooming in sharpens the COG only
  as deeper terrain tiles load. Terrain Tiles stop at zoom 15, so draped
  imagery can't be sharper than about zoom 17. 30 cm NAIP imagery is softer
  draped than it would be flat.
- **Tilted views load tiles at the center's resolution out to the horizon.**
  `COGLayer` picks every tile's resolution for the zoom at the center of the
  view, however far away the tile is. Over the NAIP images, a view tilted to
  65 degrees loads about 250 tiles at zoom 15 and over 2,000 at zoom 17, and a
  device pixel ratio of 2 asks for one level finer still. The NAIP options
  therefore stop at zoom 14 and pitch 60. Each COG also evicts its tiles out
  of view once its cached tiles pass 64 MB, so memory stays bounded.
- **No terrain, no COG.** Where no terrain tile is drawn (outside the terrain's
  coverage, or while terrain tiles load), the COG isn't drawn either. Outside
  the COGs' bounds there's no terrain, by design.
- **GPU memory.** Each terrain tile's texture can take up to 16 MB, and they're
  kept while the terrain tile is cached. A pitched 1280x800 view of the Alps
  used about 390 MB for these textures. deck.gl 9.4 doesn't delete a terrain
  tile's texture when it drops the tile, so each new scene leaves the old
  textures for garbage collection.
- **Lighting shades the COG.** The terrain's lighting darkens the draped
  colors. `material: false` on the `TerrainLayer` doesn't turn it off in
  deck.gl 9.4, but luma.gl's `material: {unlit: true}` does. deck.gl's
  `Material` type doesn't list `unlit`, so it fails type-checking where the
  props are typed as `TerrainLayerProps`, though it passes inline in
  `new TerrainLayer({...})`. `TerrainLayer` doesn't re-render tiles it has
  already drawn when `material` changes, so set it when you create the layer.
- **The camera's target eases toward the ground.** `TerrainController` picks
  the ground under the center of the view every 500 ms, except during a drag.
  It moves its target there in one step only on its first pick. After that it
  moves it 5% of the way toward the latest pick on each update during an
  interaction, and not at all while idle. So a long drag across a ridge or a
  fast zoom onto a steep peak can leave the camera inside the mountain until
  you move again. The example makes a new view, and so a new controller, for
  each scene (the two NAIP options share one) and each exaggeration, so each
  starts at its own ground height. After an exaggeration change, though, that
  first pick can miss the visible ground. Raising NAIP to 2x put the target on
  terrain beyond the summit, 2.4 km below the slope the camera sees, even with
  every terrain tile loaded. The target then eases to the ground only as you
  move, so zooming straight in can take the camera into the slope. It also
  lets pitch go to 70 degrees, above deck.gl's default of 60, but no further,
  since a steeper camera more often ends up inside a nearby ridge.
- **One view.** deck.gl renders the drape textures from the first view only,
  so other views show draped layers only where the first view's terrain tiles
  cover them.
- **Picking.** With a pickable terrain, deck.gl picks it on every pointer move.
  In deck.gl 9.4, a pick with a `terrain+draw` layer that isn't pickable logs
  "Picked non-existent layer". Picking the draped COG itself is untested.
- **No basemap.** Everything is drawn by deck.gl. Draping in MapLibre's
  interleaved mode is untested.

## Data

- Elevation: [Terrain Tiles] on the Registry of Open Data on AWS. See the
  [required attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)
  for its data sources.
- [National Map 1:1 million](https://www.swisstopo.admin.ch/en/national-map-1-1-million),
  © swisstopo.
- Kanab Point, AZ (1962), 1:62,500, from the USGS
  [Historical Topographic Map Collection](https://www.usgs.gov/programs/national-geospatial-program/historical-topographic-maps-preserving-past).
- [NAIP](https://planetarycomputer.microsoft.com/dataset/naip) 2023 aerial
  imagery from the USDA, via Microsoft Planetary Computer.
