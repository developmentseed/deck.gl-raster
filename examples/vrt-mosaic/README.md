# VRT Mosaic

This example loads a [GDAL VRT](https://gdal.org/en/stable/drivers/raster/vrt.html) mosaic of Cloud-Optimized GeoTIFFs (COGs) into a `MosaicLayer`, client-side.

It reads the [USGS 3DEP](https://www.usgs.gov/3d-elevation-program) 1 arc-second seamless elevation VRT, which lists 3,811 one-degree COGs covering the United States.

Deployed to <https://developmentseed.org/deck.gl-raster/examples/vrt-mosaic/>.

## How it works

1. The app fetches the VRT's XML, and [`parseVRT`](https://developmentseed.org/deck.gl-raster/api/deck-gl-geotiff/functions/parseVRT/) turns it into one `MosaicLayer` item per source file: the file's URL, and its WGS84 bounding box from its `DstRect` and the VRT's `GeoTransform` and `SRS`.
2. `MosaicLayer` opens a file with `COGSource.open` only once it is in view and the map is zoomed in past zoom 7, and draws it with a `COGLayer`.
3. The elevation is Float32, which the COG layer's default pipeline doesn't render, so the example brings its own `getTileData` and `renderTile` ([`src/elevation.ts`](src/elevation.ts)).

Where files overlap, GDAL draws the later source over the earlier one; `MosaicLayer` doesn't draw overlapping items in a set order. The USGS files only overlap by a few pixels of the same data, so it doesn't show here.

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
   cd examples/vrt-mosaic
   pnpm dev
   ```

4. Open your browser to http://localhost:3000
