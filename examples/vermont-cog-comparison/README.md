# Vermont COG Comparison Example

Classic swipe-map comparison of Vermont aerial imagery (1974–2025), built on `COGLayer` and deck.gl's `ClipExtension`. The first pure-deck.gl (no maplibre) example in this repo.

Deployed to <https://developmentseed.org/deck.gl-raster/examples/vermont-cog-comparison/>.

## Features

- One shared MapView; a draggable vertical handle reveals different years on the left vs. right. The geography under any pixel stays fixed as the handle moves.
- Per-side controls: pick a year, pick a render mode (grayscale, true color, false color IR, NDVI).
- Streams Cloud-Optimized GeoTIFFs directly from the [Vermont Open Data S3 bucket](https://registry.opendata.aws/vt-opendata/) — no tile server.
- Reprojects on the GPU from Vermont State Plane (EPSG:32145) to Web Mercator.

## Data Source

Vermont Open Data — `s3://vtopendata-prd/Imagery/STATEWIDE_*.tif` (anonymous GET, CORS open).

The example exposes the 9 statewide composites: 1974–1992, 1994–2000, 2006–2010, 2011–2015, 2021, 2021–2022, 2023, 2024, 2025.

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
   cd examples/vermont-cog-comparison
   pnpm dev
   ```

4. Open the printed URL.
