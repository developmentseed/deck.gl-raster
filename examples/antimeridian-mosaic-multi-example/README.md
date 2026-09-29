# Antimeridian: Mosaic + MultiCOG Example

Same DEP GeoMAD test catalog as [`antimeridian-example`](../antimeridian-example), but composed through `MosaicLayer` + `MultiCOGLayer` (R/G/B band composite) instead of a single-band `COGLayer` — the shape real usage actually needs. See [#575](https://github.com/developmentseed/deck.gl-raster/issues/575).

`src/data.ts` reads every item directly from the catalog's STAC-geoparquet (via `hyparquet`, no server-side indexing step) and pulls out the bbox and R/G/B asset hrefs. `MosaicLayer` indexes its `sources` by `bbox` in a plain Flatbush R-tree with no antimeridian awareness — a GeoJSON-flipped bbox (`minX > maxX`, RFC 7946 §5.2) for the crossing item is unwrapped onto a continuous frame before being passed in, the same convention `antimeridian-cut.ts`'s `unwrapEastLng` uses.

The debug overlay toggle exercises `MultiCOGLayer`'s own tile-outline rendering (`debug`/`debugOpacity`/`debugLevel`), confirming it also knows about the antimeridian mesh split.

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
   cd examples/antimeridian-mosaic-multi-example
   pnpm dev
   ```

4. Open your browser to http://localhost:3000
