# COGLayer Example

This example demonstrates how to use the `COGLayer` to visualize a Cloud-Optimized GeoTIFF (COG) in deck.gl.

Deployed to <https://developmentseed.org/deck.gl-raster/examples/cog-basic/>.

## Features

- Loads and displays RGB imagery from a GeoTIFF file
- Automatically handles reprojection from NZTM2000 (EPSG:2193) to Web Mercator

## Data Source

The example displays 10m resolution RGB imagery of New Zealand from LINZ (Land Information New Zealand):

- **URL**: https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff
- **Projection**: NZTM2000 (EPSG:2193)
- **Type**: RGB Cloud-Optimized GeoTIFF

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
   cd examples/cog-basic
   pnpm dev
   ```

4. Open your browser to http://localhost:3000
