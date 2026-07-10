# Boundless Tile Fetching

## The `boundless` option

`@developmentseed/geotiff`'s `GeoTIFF.fetchTile` / `Overview.fetchTile` accept a
`boundless` option:

- `boundless: true` (default) — all tiles, including edge tiles, are returned
  at the full nominal tile size (e.g. `512×512`). The out-of-bounds region is
  zero-padded, typically alongside a declared nodata value or an internal mask
  IFD.
- `boundless: false` — edge tiles are clipped on the CPU to the valid pixel
  region (e.g. `302×387` for an image that fits inside a single `512×512`
  block). The `clipToImageBounds` helper does the clipping.

## The two deck.gl layers take different defaults

**`COGLayer` uses `boundless: false`.** Edge tiles arrive pre-clipped to the
valid pixel region, and the clipped dimensions are passed straight through to
`RasterLayer` as `width` / `height`. The reprojection mesh then covers only
the valid portion of the tile and no padding is ever rendered.

**`MultiCOGLayer` uses `boundless: true`.** Edge tiles are fetched at nominal
size and rely on `FilterNoDataVal` / a mask IFD to hide padded pixels during
shader compositing.

## Why they differ

`MultiCOGLayer` composites multiple bands from different resolution groups in
a single shader pass. Its [`CompositeBands`](../packages/deck.gl-raster/src/gpu-modules/composite-bands.ts)
module uses per-band `uvTransform` uniforms to map the primary tile's UV
space onto sub-rects of lower-resolution secondary textures. That stitching
math assumes every band texture has uniform nominal tile dimensions — a
variable-width edge tile would require per-tile UV transforms that account for
both the resolution mismatch and the clipping. Keeping tiles at nominal size
sidesteps that entirely.

`COGLayer` has no analogous constraint. It renders a single source at a time,
the mesh is generated per-tile, and the tile affine from
[`tileTransform`](../packages/geotiff/src/tile-matrix-set.ts) is per-pixel —
so passing a clipped `validW × validH` through to `RasterLayer` produces a
mesh that naturally covers the valid geographic extent, with no extra math
required.

### Why not `boundless: true` + shader discard for `COGLayer` too?

Considered and rejected for now. A `UvCrop`-style shader module that
`discard`s fragments outside the valid sub-rect would keep every tile at
uniform nominal size — attractive for symmetry with `MultiCOGLayer` — but:

- The axis-aligned rectangular crop is cheap to handle on the CPU already, so
  the shader work is pure overhead.
- `COGLayer` would allocate and upload ~2× the pixels per edge tile vs. the
  CPU-crop approach.
- Future polygon cutline support (e.g. for USGS historical topo neatlines) is
  a meaningfully different problem: per-image rather than per-tile, requiring
  per-tile projection of image-space polygon vertices and either a
  point-in-polygon shader or a pre-rasterized mask texture. Building a
  rectangular `UvCrop` now wouldn't share much with that design.

If `MultiCOGLayer` ever grows polygon cutline support, we'll revisit whether
a unified shader-discard path makes sense for both layers. Until then, the
simpler CPU crop wins for `COGLayer`.

## Texture row alignment

Variable-width edge tiles previously triggered a WebGL row-alignment bug when
`width × bytesPerPixel` wasn't a multiple of 4. See
[`texture-alignment.md`](./texture-alignment.md) for the full story. That
class of bug is now handled inside luma.gl 9.3: `@luma.gl/webgl` sets
`UNPACK_ALIGNMENT = 1` and an explicit `UNPACK_ROW_LENGTH` on every write, so
tightly packed row data uploads correctly at any width. This is what makes
`COGLayer`'s `boundless: false` safe again on deck.gl/luma.gl 9.3.

## Nodata masking

`boundless: true` tiles need their padding pixels masked during rendering so
they don't appear as visible borders. Two mechanisms:

1. **Nodata value filtering** — [`FilterNoDataVal`](../packages/deck.gl-raster/src/gpu-modules/filter-nodata.ts)
   discards pixels matching a scalar nodata value. Used when the GeoTIFF
   declares a nodata value in its metadata.
2. **Internal mask (alpha band)** — some GeoTIFFs include a separate mask
   IFD. The mask band is sampled alongside the data and used to set pixel
   alpha to 0 for invalid regions.

`COGLayer` implements both in its render pipeline (for nodata interior to the
valid region, not for edge padding — its edge tiles are CPU-clipped before
rendering). `MultiCOGLayer` does not yet have nodata masking, so its edge
tiles currently render with a visible black border.
