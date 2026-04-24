# AlphaEarth Foundations Mosaic

Visualizes the AlphaEarth Foundations GeoZarr Mosaic
(`s3://us-west-2.opendata.source.coop/tge-labs/aef-mosaic/`) — 9 annual
snapshots of 64-dimensional Satellite Embeddings at ~10 m resolution — as a
user-configurable 3-band RGB composite. All 64 bands of the selected year are
uploaded per tile as a single `r8sint` Texture2DArray; switching bands is a
uniform change with no refetch. Dequantization
(`(v/127.5)² · sign(v)`) happens in the shader.

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
   cd examples/aef-mosaic
   pnpm dev
   ```

4. Open your browser to http://localhost:3000
