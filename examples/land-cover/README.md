# Land Cover Example

This example visualizes a 1.3GB land cover dataset using deck.gl and the `COGLayer`.

## Setup

1. Install dependencies from the repository root:
    ```bash
    pnpm install
    ```
1. Build the packages:
    ```bash
    pnpm build
    ```
1. Run the development server:
    ```bash
    cd examples/land-cover
    pnpm dev
    ```
1. Open your browser to http://localhost:3000/deck.gl-raster/examples/land-cover/

## Data sources

Download

```
aws s3 cp --request-payer=requester s3://usgs-landcover/annual-nlcd/c1/v1/cu/mosaic/Annual_NLCD_LndCov_1985_CU_C1V1.tif ./
aws s3 cp --request-payer=requester s3://usgs-landcover/annual-nlcd/c1/v1/cu/mosaic/Annual_NLCD_LndCov_2024_CU_C1V1.tif ./
```

Upload

```
aws s3 cp ./Annual_NLCD_LndCov_1985_CU_C1V1.tif s3://ds-deck.gl-raster-public/cog/
aws s3 cp ./Annual_NLCD_LndCov_2024_CU_C1V1.tif s3://ds-deck.gl-raster-public/cog/
```
