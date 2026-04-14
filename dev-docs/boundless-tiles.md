# Boundless Tile Fetching

## Preference for deck.gl layers: `boundless: true`

`@developmentseed/geotiff`'s `GeoTIFF.fetchTile` / `Overview.fetchTile` accept a
`boundless` option:

- `boundless: true` (default) — all tiles, including edge tiles, are returned
  at the full nominal tile size (e.g. `128×128`). The out-of-bounds region is
  zero-padded by the COG encoder, typically alongside a declared nodata value
  or an internal mask IFD.
- `boundless: false` — edge tiles are clipped on the CPU to the valid pixel
  region (e.g. `9×128` for a 265px image with 128px tiles). The
  `clipToImageBounds` helper stays available for downstream callers that want
  this.

**deck.gl-raster's `COGLayer` and `MultiCOGLayer` both explicitly pass
`boundless: true`.** This matches the default, but it is left explicit to
document the intent and avoid silent breakage if the default ever changes.

## Why the deck.gl layers use `boundless: true`

- **Uniform tile dimensions simplify UV transforms.** Cross-resolution
  stitching in `MultiCOGLayer` assumes consistent tile sizes when computing UV
  transforms between primary and secondary tilesets. Variable edge tile sizes
  would require per-tile special-casing.
- **The reprojection mesh expects tiles to match `tileWidth`/`tileHeight`.**
  The affine transform from `tileTransform` maps pixel coordinates to CRS
  coordinates assuming the full tile size. A clipped tile creates a mismatch
  between the texture dimensions and the mesh extent.
- **WebGL texture row alignment is easier at nominal tile sizes.** Partial
  edge tiles can produce row widths that interact with
  `UNPACK_ROW_LENGTH` / `UNPACK_ALIGNMENT` in surprising ways, especially for
  single-band 8-bit imagery where the row stride is not naturally aligned.
  Uploading nominal tiles sidesteps that class of bug entirely.

## Nodata masking

With `boundless: true`, padding pixels in edge tiles are filled by the COG
encoder — typically with the declared nodata value, or marked as invalid via
an internal mask IFD. These must be masked out during rendering so they don't
appear as visible borders.

Two mechanisms exist for this:

1. **Nodata value filtering** — The `FilterNoDataVal` GPU module discards
   pixels matching a scalar nodata value. Used when the GeoTIFF declares a
   nodata value in its metadata.
2. **Internal mask (alpha band)** — Some GeoTIFFs include a separate mask
   IFD. The mask band is sampled alongside the data and used to set pixel
   alpha to 0 for invalid regions.

`COGLayer` already implements both of these in its render pipeline
(`render-pipeline.ts`). `MultiCOGLayer` does not yet have nodata masking —
edge tiles currently render with a visible black border.
