# NAIP Client-side Mosaic

This example demonstrates how to use the `MosaicLayer` to visualize a client-side mosaic of Cloud-Optimized GeoTIFFs (COGs) in deck.gl.

Deployed to <https://developmentseed.org/deck.gl-raster/examples/naip-mosaic/>.

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
   cd examples/naip-mosaic
   pnpm dev
   ```

4. Open your browser to http://localhost:3000


### Regenerate STAC

Instead of hitting the Microsoft Planetary Computer API on every load for this demo, we pre-generate a minimal JSON of all STAC files in our query zone, with just `bbox` and the `href`.

```bash
curl -s 'https://planetarycomputer.microsoft.com/api/stac/v1/search?collections=naip&bbox=-106.6059%2C38.7455%2C-104.5917%2C40.4223&filter=%7B%22op%22%3A%22%3D%22%2C%22args%22%3A%5B%7B%22property%22%3A%22naip%3Astate%22%7D%2C%22co%22%5D%7D&filter-lang=cql2-json&datetime=2023-01-01T00%3A00%3A00Z%2F2023-12-31T23%3A59%3A59Z&limit=1000' | jq -c '{
    type,
    features: [
      .features[] |
      {
        bbox,
        assets: {
          image: {
            href: .assets.image.href
          }
        }
      }
    ]
}' > src/minimal_stac.json
```
