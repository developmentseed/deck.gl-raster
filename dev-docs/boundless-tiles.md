# Boundless Tile Fetching

## The `boundless` option

`@developmentseed/geotiff`'s `GeoTIFF.fetchTile` / `Overview.fetchTile` (and
`fetchTiles`) accept a `boundless` option:

- `boundless: true` (default): all tiles, including edge tiles, are returned
  at the full nominal tile size (e.g. `512x512`). Past the image, an edge tile
  holds whatever the file's writer stored there: often zeros, and not
  necessarily the nodata value.
- `boundless: false`: edge tiles are clipped on the CPU to the image (e.g.
  `302x387` for an image that fits inside a single `512x512` block). The
  `clipToImageBounds` helper does the clipping.

## Both deck.gl layers use `boundless: false`

**`COGLayer`** passes the clipped tile's dimensions straight through to
`RasterLayer` as `width` / `height`, so the reprojection mesh covers only the
image and no padding is ever uploaded or drawn.

**`MultiCOGLayer`** does the same for the bands on the primary tile grid: the
mesh takes the primary texture's clipped size. Coarser (secondary) bands are
stitched from several tiles, and their per-band `uvTransform` (applied by
[`CompositeBands`](../packages/deck.gl-raster/src/gpu-modules/composite-bands.ts))
maps the primary tile onto the stitched texture. That works with clipped tiles
because every step uses the same clipped geometry:

- [`AffineTilesetLevel.projectedTileCorners`](../packages/deck.gl-raster/src/raster-tileset/affine-tileset-level.ts)
  clips the tiles in the last column and row to the array.
- [`resolveSecondaryTiles`](../packages/deck.gl-raster/src/multi-raster-tileset/secondary-tile-resolver.ts)
  computes the `uvTransform` from those clipped extents, and the stitched
  texture's size from the far clipped corner.
- [`assembleTiles`](../packages/geotiff/src/assemble.ts) stitches the clipped
  tiles, and throws if a tile doesn't exactly fill its place in the grid.

The same clipped corners also drive the traversal's bounding volumes, deck.gl's
culling `bbox`, the Web Mercator pole clamp, and the debug outlines, so all of
them describe the part of the tile that is drawn. (`ZarrLayer` clips edge
chunks the same way.)

## Why not draw the padding and hide it?

From [#411](https://github.com/developmentseed/deck.gl-raster/pull/411) until
it switched to `boundless: false`, `MultiCOGLayer` fetched full-size tiles,
meshed the whole tile, and left hiding the padding to `FilterNoDataVal`. That
can't work in general, because the padding is not nodata. Digital Earth
Australia's Sentinel-2 files, for example, are Int16 with nodata -999, but
their padding is 0 at every level, so it drew as a black band past the scene's
right and bottom edges, up to ~54 km wide at the coarsest overview.

Hiding the padding in the shader, by rewriting it to the nodata value
([#651](https://github.com/developmentseed/deck.gl-raster/pull/651)) or by
discarding fragments outside the image with a `UvCrop`-style module, was also
rejected:

- Rewriting to nodata only helps files that have a nodata value, and only when
  the user's pipeline filters it. Linear sampling still blends a fringe of
  nodata into the edge.
- Either way, the padding is still uploaded and rasterized (more than half of
  the coarsest DEA tile), while the axis-aligned crop is cheap on the CPU.
- Future polygon cutline support (e.g. for USGS historical topo neatlines) is a
  different, per-image problem, so a rectangular crop module wouldn't share
  much with it.

## Texture row alignment

Variable-width edge tiles previously triggered a WebGL row-alignment bug when
`width x bytesPerPixel` wasn't a multiple of 4. See
[`texture-alignment.md`](./texture-alignment.md) for the full story. That
class of bug is now handled inside luma.gl 9.3: `@luma.gl/webgl` sets
`UNPACK_ALIGNMENT = 1` and an explicit `UNPACK_ROW_LENGTH` on every write, so
tightly packed row data uploads correctly at any width. This is what makes
`boundless: false` safe on deck.gl/luma.gl 9.3 and later.
