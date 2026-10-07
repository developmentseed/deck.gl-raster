# Custom projections (experimental)

Cloud-Optimized GeoTIFFs rendered in arbitrary planar map projections,
including polar stereographic, which Web Mercator can't show. There is no
basemap: rasters, coastlines and graticule are all drawn by deck.gl in the
map's own CRS.

> [!WARNING]
> Experimental. This example demonstrates what's possible ahead of official
> support in deck.gl; its architecture hasn't been reviewed and it may change
> or be withdrawn.

```bash
pnpm install
pnpm build
cd examples/experimental/custom-projection
pnpm dev
```

Projections: Arctic Polar Stereographic (EPSG:3413), Antarctic Polar
Stereographic (EPSG:3031), Equal Earth (EPSG:8857), and Web Mercator through
the same pipeline for comparison. Rasters: GEBCO 2026 global elevation
(EPSG:4326, reprojected on the fly), the NASA Explorer Base Map (natively
EPSG:3031), and EOxCloudless 2024 (EPSG:4326). Overlay: ITS_LIVE ice
velocity for Antarctica (EPSG:3031) and Greenland (EPSG:3413). Each source
keeps its own CRS and is reprojected into the map's on the GPU.

Views can be bookmarked with URL parameters (`projection`, `raster`,
`overlay`, `center` as `lng,lat`, `zoom`):

| View | Query |
| --- | --- |
| Arctic bathymetry and topography | `?projection=arctic` |
| Greenland ice flow over GEBCO | `?projection=arctic&overlay=itslive-greenland&center=-62,72&zoom=4.2` |
| Antarctica, native EPSG:3031 data | `?projection=antarctic&raster=nasa-antarctic&overlay=itslive-antarctica` |
| Svalbard close-up | `?center=15,79&zoom=6` |
| Equal Earth world | `?projection=equal-earth` |

## How it works

deck.gl merged experimental support for custom projections in
[visgl/deck.gl#10741](https://github.com/visgl/deck.gl/pull/10741)
(`_CustomProjectionView`, tracked in
[#10739](https://github.com/visgl/deck.gl/issues/10739)). It will ship with
deck.gl v10; deck.gl-raster is on 9.4. This example has three parts:

- **`src/custom-projection/`**: a stand-in for `_CustomProjectionView` built
  on deck.gl 9.4's `OrthographicView`. It takes the same options (a proj4
  converter as `projection`, `fromCrs`, `toCrs`, `fromBounds`) and the same
  `{center: [lng, lat], zoom}` view state. Its common space, zoom levels and
  `preproject` / `postUnproject` / `projectFlat` / `projectionSignature`
  match upstream's.
- **`src/projected-cog-layer/`**: `ProjectedCOGLayer`, a `COGLayer` that
  also works in a custom-projection view. It selects tiles in the map's CRS
  (`CustomProjectionTileset2D`) and has `RasterLayer` reproject each tile
  straight into map meters, drawn with `coordinateSystem: "cartesian"`. That
  is upstream's convention for preprojected positions. It only uses viewport
  members upstream's viewport also has, and takes the projection's domain as
  a `fromBounds` prop, since upstream doesn't expose it. In any other view it
  behaves like a plain `COGLayer`.
- **`src/context-layers.ts`**: coastlines, graticule and the projection's
  outline, projected on the CPU into map meters.

Source pixels are mapped to the view through lng/lat, by composing the COG's
`projectTo4326` with the view's converter. The layer never needs a proj4
definition of the map CRS, only the converter the view already has.

## Moving to deck.gl's `_CustomProjectionView`

Once deck.gl v10 ships, two changes are needed, and they must land together:

1. **In this example**, replace the shim import in `App.tsx`:

   ```ts
   import { _CustomProjectionView as CustomProjectionView } from "@deck.gl/core";
   ```

   Then delete `src/custom-projection/`. Move `pixelToWorld` (the cursor
   readout) into `App.tsx`, since it only uses members both viewports share.
   The tests build projection contexts from the shim's viewport, so port them
   to `_CustomProjectionViewport` or drop them. The layers already get the
   projection's domain through their `fromBounds` prop, which upstream's
   viewport doesn't expose.
2. **In deck.gl-raster**, detect the globe with `instanceof GlobeViewport`
   rather than `viewport.resolution !== undefined` (in `RasterLayer` and
   `RasterTileLayer`). Upstream's viewport sets `resolution = 0`. Without this
   change, `RasterLayer` would take its globe-only path, which meshes a uniform
   grid and ignores the seed that trims tiles at the domain edge and the poles.
   Geographic tiles at the poles would then render broken.

Upstream also adds pitch and bearing. Tile culling already uses the camera
frustum, but the level-of-detail test assumes a top-down camera.

Longer term, `ProjectedCOGLayer`'s logic belongs in deck.gl-raster itself,
as a third mode next to Web Mercator and globe in `RasterTileset2D` and
`RasterTileLayer`. Then `COGLayer`, `ZarrLayer` and `MultiCOGLayer` would all
work in a custom-projection view.

## Limitations

- Top-down camera only (no pitch or bearing), and no `maxBounds`.
- Rasters assume the view's `fromCrs` is WGS84 lng/lat (the default).
- Polar-native rasters that contain a pole only render in their own polar
  projection. In a world projection the pole stretches into a line and their
  tiles straddle the antimeridian, which one mesh per tile can't represent.
  The NASA basemap and the Antarctic ice velocity are only offered in the
  Antarctic projection for that reason.
- Tiles crossing the edge of the projection's domain are trimmed exactly only
  for grids whose rows are parallels (EPSG:4326, Web Mercator). Other sources
  are clamped to the domain. That folds the tile's mesh along the edge, and
  the reprojector keeps refining until it hits its iteration cap. The polar
  presets' domains therefore extend 20° past the equator, so whole-hemisphere
  polar datasets like the NASA basemap stay inside them.
- Geographic grids stop half a degree short of each pole, where their rows
  collapse to a point. That leaves a hole about 110 km across at the pole; the
  closer the mesh gets to the pole, the more triangles it needs.
- The reprojector measures mesh error in source pixels, as if they were
  square. Lng/lat pixels near a pole are slivers on a polar map, so the
  example stretches each geographic tile's pixel grid by the pixels' aspect
  ratio on the map before meshing (`columnErrorScale`). Without it a view
  straight over the pole needed over half a million triangles. The library
  should measure error in the output projection instead.
- Projections whose valid area isn't a lng/lat box, such as a single
  hemisphere in orthographic, aren't handled.
- Switching projection refetches tiles: each projection gets its own tile
  layer.

## Data

- GEBCO Compilation Group (2026) GEBCO 2026 Grid, via Source Cooperative
  (`ausantarctic/gebco`).
- NASA Earth Observatory Explorer Base Map by Joshua Stevens (MODIS Land
  Cover, SRTM, GEBCO, Natural Earth), reprojected to EPSG:3031 and distributed
  by SCAR DistAnt, CC BY 4.0
  ([doi:10.5281/zenodo.10910075](https://doi.org/10.5281/zenodo.10910075)).
- EOxCloudless 2024 by EOX IT Services GmbH (contains modified Copernicus
  Sentinel data 2024), CC BY-NC-SA 4.0.
- ITS_LIVE velocity mosaics (v2, 2014–2022 climatology), NASA MEaSUREs
  ITS_LIVE project (Gardner et al.).
- Coastlines: Natural Earth (public domain).
