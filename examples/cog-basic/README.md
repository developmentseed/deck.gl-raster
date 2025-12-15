# COGLayer Example

This example demonstrates how to use the `COGLayer` to visualize a Cloud-Optimized GeoTIFF (COG) in deck.gl.

## Features

- Loads and displays RGB imagery from a GeoTIFF file
- Automatically handles reprojection from NZTM2000 (EPSG:2193) to Web Mercator
- Uses adaptive mesh refinement for accurate reprojection
- Interactive map controls with deck.gl

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

## Code Overview

The example uses:
- **React** for UI components
- **deck.gl** for WebGL rendering
- **react-map-gl** for the base map
- **geotiff.js** for loading COG files
- **COGLayer** for rendering the reprojected imagery

### Key Code

```tsx
import { Map, useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-cog";
import { fromUrl } from "geotiff";

function DeckGLOverlay(props) {
  const overlay = useControl(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

// Load the GeoTIFF
const geotiff = await fromUrl(COG_URL);

// Create the layer
const layers = [
  new COGLayer({
    id: "cog-layer",
    geotiff,
    maxError: 0.125, // Reprojection error tolerance in pixels
  }),
];

// Render
<Map>
  <DeckGLOverlay layers={layers} />
</Map>
```

## Customization

You can adjust the reprojection accuracy by changing the `maxError` prop:
- **Lower values** (e.g., 0.05): Higher accuracy, denser mesh, more GPU memory
- **Higher values** (e.g., 0.5): Lower accuracy, simpler mesh, less GPU memory
- **Default**: 0.125 pixels

Try different values to balance visual quality and performance for your use case.
