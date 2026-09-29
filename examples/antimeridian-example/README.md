# Antimeridian Crossing Example

Renders every `COGLayer` in the [Digital Earth Pacific](https://digitalearthpacific.org) Landsat GeoMAD test catalog (EPSG:3832 / PDC Mercator) — a 4×3 grid of 12 tiles, read live from the catalog's STAC-geoparquet — side by side, as-is:

- The 3 tiles at column `066` (`dep_ls_geomad_066_020/021/022_2025`) cross the ±180° antimeridian. Their corner longitudes come out GeoJSON-flipped ([RFC 7946 §5.2](https://datatracker.ietf.org/doc/html/rfc7946#section-5.2): west > east, e.g. `179.97 → −179.17`), since `proj4`'s inverse projection normalizes output to `(−180°, 180°]`.
- The other 9 tiles, same catalog, don't cross — for comparison.

See [#575](https://github.com/developmentseed/deck.gl-raster/issues/575) for the antimeridian-handling design.

## Setup

1. Install dependencies from the repository root:
   ```bash
   pnpm install
   ```

2. Build the packages:
   ```bash
   pnpm build
   ```

3. Run the development server:
   ```bash
   cd examples/antimeridian-example
   pnpm dev
   ```

4. Open your browser to http://localhost:3000
