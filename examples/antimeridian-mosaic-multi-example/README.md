# Antimeridian: Mosaic + MultiCOG Example

Same two DEP GeoMAD items as [`antimeridian-example`](../antimeridian-example), but composed through `MosaicLayer` + `MultiCOGLayer` (R/G/B band composite) instead of a single-band `COGLayer` — the shape real usage actually needs. See [#575](https://github.com/developmentseed/deck.gl-raster/issues/575).

`MosaicLayer` indexes its `sources` by `bbox` in a plain Flatbush R-tree with no antimeridian awareness — a GeoJSON-flipped bbox (`minX > maxX`, RFC 7946 §5.2) for the crossing item is unwrapped onto a continuous frame in `src/data.ts` before being passed in, the same convention `antimeridian-cut.ts`'s `unwrapEastLng` uses.

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
