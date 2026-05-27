# NLDAS-3 icechunk Example

Renders a single timestep of NLDAS-3 air temperature (`Tair`) from a public
[icechunk](https://icechunk.io) repository, read in the browser via
[`icechunk-js`](https://github.com/EarthyScience/icechunk-js) + zarrita and
displayed with `@developmentseed/deck.gl-zarr`'s `ZarrLayer`.

The store is a *virtual* Zarr: its chunks reference NLDAS-3 source objects in
the same public `nasa-waterinsight` S3 bucket, authorized through a
`virtualChunkContainers` map.

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
   cd examples/nldas-icechunk
   pnpm dev
   ```
4. Open your browser to http://localhost:3000

## Re-deriving the grid

`src/nldas/metadata.ts` hard-codes the grid (the virtual store is not
GeoZarr-compliant). To re-derive it, run the spike:

```bash
cd examples/nldas-icechunk
pnpm exec tsx scripts/smoke.ts
```
