# Scripts

The measurements behind [the report](../../../openlayers-raster-comparison.md).
`results/` holds their output from 2026-11-16 (Apple M2 Pro, Node 24.21.0,
proj4 2.22.0).

| Script | Measures | Needs |
|---|---|---|
| `openlayers-vs-ours.mjs` | OpenLayers' `Triangulation` against our `RasterReprojector` on the same images: the same job (A), and each library as it runs (B) | `OPENLAYERS_DIR` |
| `overzoom-error.mjs` | Mesh error past a 10 m tile's own level, ours against OpenLayers | `OPENLAYERS_DIR` |
| `reprojector-variants.mjs` | `main`, `main` with a coordinate cache, PR [#759], the map-space Delaunay test, and [#759] with it | PR [#759]'s commit |
| `overzoom-refine.mjs` | Refining a mesh in place for each extra zoom level, against rebuilding it | |

`common.mjs` holds the shared setup. It reads `delatin.ts` at the commit the
report studied with `git show`, writes it to a temporary directory and imports
it with Node's type stripping. The scripts therefore measure that code
whatever the working tree holds. The map-space variant is a text patch of that
file (`withMapSpaceDelaunayTest`).

## Running

From the repository root, after `pnpm install`:

```sh
# OpenLayers at the commit the report read. Its src/ runs in Node as is.
git clone https://github.com/openlayers/openlayers.git ../openlayers
git -C ../openlayers checkout e50554baf350ea5ab1c1db6e7aa530b29fc5681f

# PR #759's head commit, for reprojector-variants.mjs.
git fetch origin pull/759/head

cd dev-docs/reports/research-notes/openlayers-raster-comparison/scripts
OPENLAYERS_DIR=../../../../../../openlayers node openlayers-vs-ours.mjs
OPENLAYERS_DIR=../../../../../../openlayers node overzoom-error.mjs
node reprojector-variants.mjs
node overzoom-refine.mjs
```

Each script prints Markdown tables to stdout. Node may print a warning about
type stripping to stderr.

[#759]: https://github.com/developmentseed/deck.gl-raster/pull/759
