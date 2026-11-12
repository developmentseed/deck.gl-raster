# Custom projections (experimental)

Cloud-Optimized GeoTIFFs rendered in arbitrary planar map projections.

Rasters, coastlines and graticule are all drawn by deck.gl in the
map's own CRS.

> [!WARNING]
> This example is experimental.
>
> This is intended to demonstrate how deck.gl-raster will support custom projections in the future once deck.gl v10 is released.
>
> See [visgl/deck.gl#10739](https://github.com/visgl/deck.gl/issues/10739) for
> more information.

## deck.gl v10

The example runs on deck.gl 9.4. `src/custom-projection/` stands in for
deck.gl v10's experimental `_CustomProjectionView`, and follows its API as
of `v10.0.0-alpha.1`: the view takes a `crs` (a PROJ string, WKT, PROJJSON or
one of the few EPSG codes math.gl knows, such as `EPSG:3857`), which math.gl
5's projection engine (`@math.gl/geospatial`) resolves, as in v10.

To move to deck.gl v10:

1. Import `_CustomProjectionView` from `@deck.gl/core` in place of the
   stand-in's `CustomProjectionView`.
2. Resolve CRSs with math.gl's `projectionEngine.getCRS` in place of the
   stand-in's `resolveCRS`.
3. Delete `src/custom-projection/`.

To view locally:

```bash
pnpm install
pnpm build
cd examples/experimental/custom-projection
pnpm dev
```

## Limitations

- Top-down camera only (no pitch or bearing), and no `maxBounds`.
- Map CRSs must be in meters. Upstream also takes other linear units.
- Polar-native rasters that contain a pole only render in their own polar
  projection. In a world projection the pole stretches into a line and their
  tiles straddle the antimeridian, which one mesh per tile can't represent.
  The NASA basemap and the Antarctic ice velocity are only offered in the
  Antarctic projection for that reason.
- Tiles crossing the edge of the projection's domain are trimmed exactly only
  for grids whose rows are parallels (EPSG:4326, Web Mercator). Other sources
  are clamped to the domain. That folds the tile's mesh along the edge, and
  the reprojector keeps refining until it hits its iteration cap. Each map's
  domain is the latitude band that math.gl clamps its CRS to: 60° past the
  equator for polar stereographic, so whole-hemisphere polar datasets like
  the NASA basemap stay inside it.
- Geographic grids stop half a degree short of each pole, where their rows
  collapse to a point. That leaves a hole about 110 km across at the pole. The
  cut dates from when the mesh's error was measured in source pixels, which
  never converged there; in output pixels it does, and the cut saves only
  about 1% of the triangles.
- Projections whose valid area isn't a latitude band, such as a single
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
