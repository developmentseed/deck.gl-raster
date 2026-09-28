# Antimeridian Crossing Example

Renders two `COGLayer`s from the same [Digital Earth Pacific](https://digitalearthpacific.org) Landsat GeoMAD catalog (EPSG:3832 / PDC Mercator), side by side, as-is:

- `dep_ls_geomad_066_022_2025` — crosses the ±180° antimeridian. Its corner longitudes come out GeoJSON-flipped ([RFC 7946 §5.2](https://datatracker.ietf.org/doc/html/rfc7946#section-5.2): west > east, e.g. `179.97 → −179.17`), since `proj4`'s inverse projection normalizes output to `(−180°, 180°]`.
- `dep_ls_geomad_064_020_2025` — same catalog, doesn't cross — for comparison.

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
