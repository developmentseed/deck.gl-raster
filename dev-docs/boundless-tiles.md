# Boundless Tile Fetching

## Preference: `boundless: true`

When fetching tiles from GeoTIFFs, we prefer `boundless: true` so that all tiles — including edge tiles — are returned at the full nominal tile size (e.g., 1024x1024). Edge tiles that extend beyond the image extent are padded by the COG encoder, typically with the nodata value or accompanied by an internal nodata mask.

## Why

With `boundless: false`, edge tiles are clipped to the valid pixel region (e.g., 740x1024 for a 10980px image with 1024px tiles). This creates problems:

- **Uniform tile dimensions simplify UV transforms.** Cross-resolution stitching in `MultiCOGLayer` assumes consistent tile sizes when computing UV transforms between primary and secondary tilesets. Variable edge tile sizes would require per-tile special-casing.
- **The reprojection mesh expects tiles to match `tileWidth`/`tileHeight`.** The affine transform from `tileTransform` maps pixel coordinates to CRS coordinates assuming the full tile size. A clipped tile creates a mismatch between the texture dimensions and the mesh extent.

## Nodata Masking

With `boundless: true`, padding pixels in edge tiles are filled by the COG encoder — typically with the declared nodata value, or marked as invalid via an internal mask IFD. These must be masked out during rendering so they don't appear as visible borders.

Two mechanisms exist for this:

1. **Nodata value filtering** — The `FilterNoDataVal` GPU module discards pixels matching a scalar nodata value. Used when the GeoTIFF declares a nodata value in its metadata.
2. **Internal mask (alpha band)** — Some GeoTIFFs include a separate mask IFD. The mask band is sampled alongside the data and used to set pixel alpha to 0 for invalid regions.

`COGLayer` already implements both of these in its render pipeline (`render-pipeline.ts`). `MultiCOGLayer` does not yet have nodata masking — edge tiles currently render with a visible black border.
