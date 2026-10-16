# COG on terrain (experimental)

A Cloud-Optimized GeoTIFF draped over 3D terrain with deck.gl's experimental
[`TerrainExtension`][terrain-extension].

The COG and the terrain don't share a tile grid. The COG is tiled in its own
projection: the Swiss LV95 grid (EPSG:2056) or, for the 1962 USGS map, a NAD27
polyconic projection. The elevation comes from [Terrain Tiles], which are Web
Mercator XYZ tiles.

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
import type { TerrainExtensionProps } from "@deck.gl/extensions";
import { _TerrainExtension as TerrainExtension } from "@deck.gl/extensions";
import { TerrainLayer } from "@deck.gl/geo-layers";
import type { COGLayerProps } from "@developmentseed/deck.gl-geotiff";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";

const terrain = new TerrainLayer({
  elevationData:
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  elevationDecoder: { rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768 },
  maxZoom: 15, // the deepest Terrain Tiles zoom
  operation: "terrain+draw",
});

const cogProps: COGLayerProps & TerrainExtensionProps = {
  id: "cog",
  geotiff: "https://example.com/image.tif",
  extensions: [new TerrainExtension()],
  terrainDrawMode: "drape",
  zRange: [0, 4810],
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
  terrain, because the terrain lifts them into view.
- `COGLayerProps` doesn't include extension props, so the props go through a
  typed variable. An inline object literal fails TypeScript's excess property
  check on `terrainDrawMode`.

In drape mode, deck.gl never draws the COG directly. For each terrain tile it
keeps a texture covering that tile's longitude/latitude bounds. It renders into
that texture every COG tile in view whose bounds overlap the terrain tile, using
a flat, top-down Web Mercator view, and deck.gl-raster reprojects each COG tile
on the GPU as usual. The terrain mesh then samples that texture.

The only link between the two tile grids is that overlap test. It uses the
WGS84 bounds that deck.gl-raster computes for every COG tile, so the COG can be
in any projection and tiled any way.

## Limitations

- **The terrain tiles, not the COG, set the resolution.** Each terrain tile's
  texture is at most 2048 px wide, at most two zoom levels finer than the
  terrain tile. Its size is fixed when the terrain tile first appears and
  ignores the screen's `devicePixelRatio`, so zooming in sharpens the COG only
  as deeper terrain tiles load. Terrain Tiles stop at zoom 15, so draped
  imagery can't be sharper than about zoom 17. That's plenty for these maps,
  but decimeter imagery looks blurry.
- **No terrain, no COG.** Where no terrain tile is drawn (outside the terrain's
  coverage, or while terrain tiles load), the COG isn't drawn either.
- **GPU memory.** Each terrain tile's texture can take up to 16 MB, and they're
  kept while the terrain tile is cached. A pitched 1280x800 view of the Alps
  used about 390 MB for these textures.
- **Lighting shades the COG.** The terrain's lighting darkens the draped
  colors. `material: false` on the `TerrainLayer` doesn't turn it off in
  deck.gl 9.4, but luma.gl's `material: {unlit: true}` does. deck.gl's
  `Material` type doesn't list `unlit`, so it fails type-checking where the
  props are typed as `TerrainLayerProps`, though it passes inline in
  `new TerrainLayer({...})`. `TerrainLayer` doesn't re-render tiles it has
  already drawn when `material` changes, so set it when you create the layer.
- **Camera height.** deck.gl's default `MapController` keeps the camera's
  target at sea level, so the camera gets closer to the ground as you zoom in,
  tilt, or shrink the window. Over high terrain it can end up inside a
  mountain. The example caps zoom and pitch for each map, which makes that
  rare, not impossible. deck.gl 9.4's `TerrainController` instead moves the
  target to the terrain under the center of the view; this example doesn't use
  it.
- **One view.** deck.gl renders the drape textures from the first view only,
  so other views show draped layers only where the first view's terrain tiles
  cover them.
- **Picking is off.** deck.gl picks on every pointer down, and in deck.gl 9.4
  that logs "Picked non-existent layer" when a `terrain+draw` layer isn't
  pickable. The example has nothing to pick, so it sets `_pickable: false` on
  the `Deck`. Picking a draped COG is untested.
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
