# COGLayer Globe Example

Renders a Cloud-Optimized GeoTIFF on a 3D globe using MapLibre's
`projection="globe"` with deck.gl interleaved rendering.

```bash
pnpm install
pnpm --filter @developmentseed/deck.gl-raster build
pnpm --filter @developmentseed/deck.gl-geotiff build
pnpm --filter deck.gl-cog-globe-example dev
```
