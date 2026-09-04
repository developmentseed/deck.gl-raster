# GPU Hillshade — USGS 3DEP 1-meter Elevation

Slope and relief shading computed **on the GPU** from USGS 3DEP 1-meter lidar
elevation, streamed straight from the National Map's public S3 bucket. A tile
server bakes hillshade in at ingest time behind a fixed sun angle; here the sun
angle is a slider.

```sh
pnpm dev
```

## What this example shows

Every other shader module in `deck.gl-raster` is **per-pixel**: `LinearRescale`,
`Colormap`, and `FilterNoDataVal` each read one texel and write one color.
Hillshade is the first **convolutional** one — Horn's method needs a 3×3
neighborhood to estimate `dz/dx` and `dz/dy`. Three things follow from that.

### The halo

A tile's texture holds exactly that tile's texels, so at the border the ±1 tap
falls outside it and `CLAMP_TO_EDGE` halves the computed gradient — a visible
seam grid along every tile boundary, worst in exactly the steep terrain this
example exists to show.

So each tile uploads a `(tileWidth + 2) × (tileHeight + 2)` texture whose
outermost ring is copied from its eight neighbors ([`halo.ts`](src/halo.ts)).
Naively that costs nine decodes per tile — but the neighbors are *themselves*
tiles the layer is about to render, so a shared cache
([`tile-cache.ts`](src/tile-cache.ts)) brings the steady-state cost back to
about one decode per tile plus a one-tile ring around the viewport.

Loading is two-phase, so no tile waits on its neighbors to appear
([`get-tile-data.ts`](src/get-tile-data.ts)): the tile draws as soon as it
decodes, using whatever neighbors have already arrived, and its halo is
rewritten in place when the stragglers land.

The halo does not disturb geometry. `RasterLayer` takes a tile's dimensions
from what `getTileData` returns rather than from the texture, so returning the
*logical* size keeps the mesh on the unpadded grid and leaves only the shader
to account for the one-texel inset.

### `cellSize` is per-tile

Slope is rise over *ground* distance, and a tile may come from any overview
level — 1 m through 32 m for these products. `getTileData` receives the actual
`GeoTIFF | Overview` being read, so it derives the ground sample distance from
that image's transform and passes it through as a uniform.

Because the gradient is computed in the source raster's own texel grid (UTM
meters here), it stays correct however `RasterLayer` reprojects the tile mesh
for display. Reprojection never enters the shading math.

### Composing with the library's modules

[`TerrainDerivative`](src/gpu-modules/terrain-derivative.ts) is the head module
and the only place the 3×3 kernel is written. It publishes `elevation`,
`slopeDegrees`, `shade`, and `valid` as function-locals, and the small modules
downstream turn those into color — the scalar modes by writing a value that the
library's own `LinearRescale` and `Colormap` then colorize:

| Mode | Pipeline |
| --- | --- |
| Tinted relief | `TerrainDerivative` → `ElevationScalar` → `LinearRescale` → `Colormap` → `MultiplyShade` |
| Hillshade | `TerrainDerivative` → `Hillshade` |
| Slope | `TerrainDerivative` → `SlopeDegrees` → `LinearRescale` → `Colormap` |
| Elevation | `TerrainDerivative` → `ElevationScalar` → `LinearRescale` → `Colormap` |

This replaces the library's `CreateTexture`, which samples at `geometry.uv` with
no inset and so cannot address a halo texture. The land-cover example makes the
same substitution for its integer pipeline.

## The data

[USGS 3DEP](https://www.usgs.gov/3d-elevation-program) 1-meter DEMs from
`s3://prd-tnm`, staged as 10 km × 10 km cells: float32, LZW, internally tiled,
with overview factors `[2, 4, 8, 16, 32]`.

The five cells in [`usgs/cells.ts`](src/usgs/cells.ts) deliberately span both
product vintages, so nothing may be hardcoded: the older `USGS_one_meter_*`
files are tiled at 256 px and the newer `USGS_1M_*` at 512 px, across three UTM
zones and two different nodata sentinels.

## Tests

```sh
pnpm test
```

[`halo.ts`](src/halo.ts) is a pure function over typed arrays and the piece most
likely to be subtly wrong — off-by-one strip offsets, transposed corners, wrong
edge replication at the image border — so it is covered directly in
[`tests/halo.test.ts`](tests/halo.test.ts).
