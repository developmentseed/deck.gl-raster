# GPU hillshade and slope from USGS 3DEP 1m elevation

- **Date:** 2026-09-03
- **Status:** Proposed
- **Kind:** New example (`examples/terrain-usgs/`)
- **Related:** [`examples/land-cover/`](../../examples/land-cover/) (custom `getTileData` + `renderTile` precedent), [`examples/dynamical-zarr-ecmwf/`](../../examples/dynamical-zarr-ecmwf/) (float scalar → `LinearRescale` → `Colormap` precedent)

## Goal

A 2D example that streams USGS 3DEP 1-meter lidar DEMs straight from S3 and computes
**hillshade, slope, and tinted relief entirely on the GPU**, with the sun angle under
interactive user control. No server, no pre-baked shading.

The point of the demo is the contrast with a conventional tile server, which bakes
hillshade in at ingest time behind a fixed sun azimuth. Here the derivative is computed
per-fragment from float32 elevation, so dragging an azimuth slider re-lights the terrain
at frame rate.

Explicitly **not** in scope: 3D terrain / vertex displacement. The mesh stays flat.

## Why it's hard

Every other shader module in this project is **per-pixel**: `LinearRescale`, `Colormap`,
`FilterNoDataVal`, `CompositeBands` each read one texel and write one color. Hillshade is
the first **convolutional** operation — Horn's method needs a 3×3 neighborhood to estimate
`dz/dx` and `dz/dy`.

That collides with the tiling architecture. `RasterTileLayer` fetches and renders each tile
independently, and a tile's texture holds exactly that tile's texels. In the outermost texel
row/column, the ±1 tap falls outside the texture; `CLAMP_TO_EDGE` returns the row itself, so
the central difference is computed over half the true distance. The result is a halved
gradient in a 1-texel band tracing every tile boundary — a visible grid, worst in steep
terrain, which is precisely the terrain this example exists to show.

The fix is to give each tile a one-texel halo of its neighbors' data: upload a
`(tileWidth + 2) × (tileHeight + 2)` texture instead of `tileWidth × tileHeight`.

### Why the halo is affordable

Naively, a 3×3 halo costs 9× the decode per tile. It does not, because **the 8 neighbors are
themselves deck.gl tiles that will be fetched anyway** — they are in the viewport. Placing a
shared decoded-tile cache in front of `fetchTile`, keyed `${level}/${x}/${y}` and storing the
in-flight `Promise<Tile>`, makes each source tile fetched and decoded exactly once and
consumed by up to 9 halo assemblies. Steady-state cost approaches 1×, plus a one-tile ring
around the viewport.

Tile independence stops mattering because the work is shared, not duplicated.

### Why the halo does not disturb geometry

[`raster-tile-layer.ts:412`](../../packages/deck.gl-raster/src/raster-tile-layer/raster-tile-layer.ts#L412)
reads `const { width, height } = props.data` — the dimensions come from whatever
`getTileData` returns, **not** from the uploaded texture. So `getTileData` uploads a
`(w+2)×(h+2)` texture while returning `width: w, height: h`. The reprojector triangulates
the unpadded tile grid exactly as before, mesh UVs still span 0..1 over the logical tile, and
only the shader's own sampling needs a one-texel inset. **No library change is required.**

This keeps seam handling in application code, as intended. Hillshade is not yet a
general-enough concern to justify a public API.

## Data

USGS 3DEP 1-meter DEMs from the public National Map bucket, `s3://prd-tnm`
(`https://prd-tnm.s3.amazonaws.com`, verified `Access-Control-Allow-Origin: *` with working
HTTP range GETs). Products are 10 km × 10 km cells, float32, LZW, internally tiled, with
overview factors `[2, 4, 8, 16, 32]` — valid COGs.

Five hand-picked cells, verified to exist and to contain the named landmark:

| Cell | Project | CRS | Tile | nodata |
| --- | --- | --- | --- | --- |
| `USGS_1M_12_x39y400` (Grand Canyon, South Rim) | `AZ_GrandCanyonNP_2019_B19` | 26912 | 512 | −999999 |
| `USGS_one_meter_x32y413` (Zion Canyon) | `UT_ZionNP_QL1_2016` | 26912 | 256 | −3.4028235e38 |
| `USGS_1M_11_x27y419` (Yosemite, Half Dome) | `CA_YosemiteNP_2019_D19` | 26911 | 256 | −999999 |
| `USGS_1M_12_x51y485` (Grand Teton) | `WY_GrandTetonNP_D22` | 26912 | 512 | −999999 |
| `USGS_one_meter_x58y541` (Mount Baker) | `WA_MtBaker_2015` | 26910 | 256 | −999999 |

All are 10012 × 10012.

Three properties of this set drive the design, and none may be hardcoded:

1. **Internal tile size varies** (256 or 512 by vintage) — the halo is `tileWidth + 2`, read
   from the image.
2. **nodata varies** (−999999 or −FLT_MAX) — read from the GeoTIFF tag.
3. **CRS varies** across three UTM zones — handled by the existing reprojection path, and a
   free demonstration that the shading math is projection-independent (see below).

## Design

### Cell size is a per-tile uniform

Slope is `dz` over **ground** distance, so the shader needs meters-per-texel. A tile may come
from any overview level, where the ground sample distance is 1, 2, 4, 8, 16, or 32 m.

`getTileData(image, options)` receives the actual `GeoTIFF | Overview` being read, so it can
derive `cellSize` from that image's transform and attach it to the returned tile data;
`renderTile` forwards it as a uniform.

Because gradients are computed in the source raster's **own texel grid** — which is UTM
meters for every cell in the table — the derivative is correct regardless of how
`RasterLayer` reprojects the tile mesh for display. Reprojection never enters the shading
math. This is the single most instructive thing in the example.

### Halo assembly (application code)

In `src/halo.ts`, a pure function:

```
buildHaloArray({ center, neighbors, tileWidth, tileHeight }) -> Float32Array
```

Allocates `(tileWidth + 2) * (tileHeight + 2)`, blits the center tile at offset (1,1), then
copies one-texel strips from the 8 neighbors (4 edges + 4 corners; Horn's method uses
corners). Where a neighbor does not exist — the tile lies on the image border — the center
tile's own edge is replicated, matching `gdaldem` behavior at raster edges.

Written by hand rather than via [`assembleTiles`](../../packages/geotiff/src/assemble.ts),
which requires a contiguous rectangular grid and so cannot express missing border neighbors.

Cache misses are batched into one
[`fetchTiles`](../../packages/geotiff/src/overview.ts#L141) call; the neighbors occupy
adjacent byte ranges, so [`coalesce.ts`](../../packages/geotiff/src/coalesce.ts) merges them
into few requests.

### Tile cache (application code)

`src/tile-cache.ts` — a bounded LRU keyed `${level}/${x}/${y}` storing `Promise<Tile>`, so
concurrent halo assemblies requesting the same neighbor share one in-flight fetch rather than
racing. Capacity is sized to comfortably exceed the tiles visible at one zoom, so the
viewport ring stays resident. Entries hold decoded `Float32Array`s and must be evicted by
count to bound memory.

### Shader modules

The library's [`CreateTexture`](../../packages/deck.gl-raster/src/gpu-modules/create-texture.ts)
samples `texture(textureName, geometry.uv)` with no inset, which is wrong for a halo texture.
So this pipeline replaces it with its own head module — the same move
[`land-cover`](../../examples/land-cover/src/gpu-modules/create-texture-uint.ts) makes with
`CreateTextureUint`.

In `src/gpu-modules/`:

- **`TerrainDerivative`** — the head module, and the only place the 3×3 kernel is written. Owns
  the halo texture, reads the 3×3 neighborhood with `texelFetch` at
  `ivec2(geometry.uv * vec2(tileSize)) + 1` (the `+1` being the halo inset), and applies Horn's
  method. Uniforms: `haloTexture`, `tileSize`, `cellSize`, `zFactor`, `nodata`. Neighbors equal
  to nodata are excluded from the gradient, otherwise lidar voids along canyon rims produce
  false cliffs.

  Pipeline contract, following `CreateTextureUint`'s precedent:
  - Writes: `float elevation`, `float slope`, `float aspect`, `bool valid` (function-locals
    scoped to `DECKGL_FILTER_COLOR`)
  - Reads: nothing
  - Does **not** write `color` — a downstream module must.

- **`Hillshade`** — reads `slope`/`aspect`, applies sun position (`sunAzimuth`, `sunAltitude`),
  writes a grayscale factor to `color`.
- **`SlopeDegrees`** / **`ElevationScalar`** — write `slope` (in degrees) or `elevation` to
  `color.r` so the **library's existing** `LinearRescale` + `Colormap` colorize them. Reusing
  shipped modules is a better teaching story than reimplementing colormapping.
- **`MultiplyShade`** — recomputes the shading factor from `slope`/`aspect` and multiplies it
  into an already-colormapped `color`, producing tinted relief.

Every pipeline below therefore begins with `TerrainDerivative` rather than `CreateTexture`, and
`discard`s where `valid` is false.

### Render modes

Composed in `src/render-tile.ts`:

| Mode | Pipeline |
| --- | --- |
| **Tinted relief** (default) | `TerrainDerivative` → `ElevationScalar` → `LinearRescale` → `Colormap` → `MultiplyShade` |
| **Hillshade** | `TerrainDerivative` → `Hillshade` |
| **Slope** | `TerrainDerivative` → `SlopeDegrees` → `LinearRescale` → `Colormap` |
| **Elevation** | `TerrainDerivative` → `ElevationScalar` → `LinearRescale` → `Colormap` |

### UI

Standard example shell — MapLibre + `DeckGlOverlay` + `ControlPanel` from
`deck.gl-raster-examples-shared`:

- Cell dropdown (the five above), with `fitBounds` on load, as in `cog-basic`.
- Mode dropdown.
- Sun azimuth `0–360°` and sun altitude `0–90°` sliders (`RangeSlider`).
- Vertical exaggeration (`zFactor`) slider.
- Colormap picker (`ColormapPreview`) for the scalar modes.
- USGS 3DEP attribution.

## File layout

```
examples/terrain-usgs/
  index.html, package.json, tsconfig.json, vite.config.ts, README.md
  src/
    main.tsx
    App.tsx
    usgs/cells.ts        # the five cells + attribution
    tile-cache.ts        # shared LRU of Promise<Tile>
    halo.ts              # buildHaloArray (pure, unit-tested)
    get-tile-data.ts     # neighbor fetch + halo + texture upload
    gpu-modules/         # TerrainDerivative, Hillshade, SlopeDegrees,
                         # ElevationScalar, MultiplyShade, index.ts
    render-tile.ts
```

Plus a card in [`docs/src/pages/examples/index.tsx`](../../docs/src/pages/examples/index.tsx)
and a hero image. CI globs `examples/*/`
([`docs.yml:44`](../../.github/workflows/docs.yml#L44)), so no workflow change.

`examples/terrain-usgs/` currently holds unrelated scratch data (a 1.4 GB GeoPackage, a
`.mypy_cache`). None of it is to be committed; the user will clean it up.

## Testing

- **Unit (vitest):** `buildHaloArray` is a pure function over typed arrays and is the piece
  most likely to be wrong — off-by-one in strip offsets, transposed corners, wrong edge
  replication. Test against a hand-computed small grid: interior tile with all 8 neighbors,
  corner tile with 3, edge tile with 5. This is the TDD target and should be written first.
- **Visual:** the seam test is the whole point — screenshot Grand Canyon at native zoom and
  confirm no grid is visible along tile boundaries. A deliberate no-halo build is the control:
  if the seams are not visible without the halo, the halo is not carrying its weight and the
  design should be reconsidered.
- **Cross-vintage:** load one 256-tile cell (Zion, with `-FLT_MAX` nodata) and one 512-tile
  cell (Grand Canyon) to confirm nothing is hardcoded.

## Risks and open questions

- **Halo cost may still bite on first paint.** Before the cache warms, a viewport of *n*
  tiles costs up to `n + ring` decodes rather than `n`. If first paint feels slow on 250 MB
  cells, the fallback is to drop corner taps and use a 4-neighbor
  (Zevenbergen–Thorne) kernel, reducing the halo to 4 neighbors instead of 8. Decide from a
  measurement, not up front.
- **`r32float` filtering.** The format is in the table at
  [`texture.ts:154`](../../packages/deck.gl-geotiff/src/geotiff/texture.ts#L154), and the
  shader uses `texelFetch` (unfiltered) for the kernel, so linear-filter support is not
  required. To be confirmed on first render.
- **Colormap choice for tinted relief.** A perceptually reasonable elevation ramp matters
  more here than in the categorical examples; the per-cell elevation range differs greatly
  (Zion ~1100–2200 m, Mount Baker ~200–3200 m), so rescale bounds likely need to be
  per-cell constants in `cells.ts` rather than a single global default.
