# Antimeridian crossing: what it took (summary)

Four real bugs. The first three are in `packages/deck.gl-raster/src/raster-tileset/`, on top of PR #576's existing split-in-two design (`antimeridian-cut.ts`'s `uCut` + two `RasterLayer` pieces). The fourth is in `packages/deck.gl-geotiff/src/mosaic-layer/`, and only shows up once a crossing dataset is used through `MosaicLayer` + `MultiCOGLayer` instead of a plain `COGLayer`.

## Fixed

1. **Crossing detection missed projected (non-4326) sources.** `edgeUCut` (`antimeridian-cut.ts`) only accepted "native un-normalized" corner lngs (`west < east` always, e.g. `−204°, −162°` — true for a 4326 source). A projected source (e.g. EPSG:3832) makes `projectTo4326` normalize its output to `(−180°, 180°]`, so a crossing tile shows up **GeoJSON-flipped** instead (`west > east`, e.g. `179.97°, −179.17°` — RFC 7946 §5.2's own convention). Fix: `unwrapEastLng` adds 360° when `east < west` before the seam search. Needed for any real-world projected-CRS COG, not just STAC's bbox convention — it's `proj4` normalization, unrelated to STAC.

2. **Piece reprojection shifted the wrong stage.** `buildPieceReprojection` used to add a `+k·360°` shift to `forwardTransform`'s *output* (source-CRS native units). That's correct only when native units are degrees (the 4326 case); for a projected CRS (meters), it silently added `360 meters`, and — more subtly — a single constant-per-piece shift is simply wrong at the piece's own boundary corner, which coincides with the *other* piece's edge and needs no shift at all. Fix: correct `forwardReproject`'s *output* instead (common space, post-projection — where the discontinuity actually lives), per-point: `raw x < TILE_SIZE/2 → +TILE_SIZE`, else unchanged. No longer needs to know which piece it is or any precomputed midpoint.

3. **Debug outline didn't know about the split.** `renderDebugTileOutline` drew one box from the tile's raw (un-split) WGS84 corners — for a crossing tile, `PathLayer` connected `179.97° → −179.17°` the long way around the globe. Fixed to draw two boxes (one per piece) in common space, using each piece's own `forwardReproject`, matching the real render split.

4. **`MosaicLayer`'s spatial index missed sources in the "other" world copy.** `MosaicTileset2D.getTileIndices` queried its Flatbush index once, with `viewport.getBounds()`'s raw lng/lat bounds. When the view spans the antimeridian, deck.gl renders multiple world-copy sub-viewports (`viewport.subViewports`), and each reports bounds for a different 360°-shifted copy of the world — but every source's bbox is indexed in only one of those copies (e.g. the crossing item's unwrapped `[179.97°, 180.83°]` bbox). A query landing in the wrong copy (e.g. `[-189.6°, -170.4°]`) found nothing, so the source dropped out of the tileset entirely — no tiles, no `MultiCOGLayer`, blank map. Fixed by re-querying the index with the bounds shifted by ±360°, ±720°, ±1080° whenever `subViewports.length > 1`, unioning the results (deduping via a `Set`) — the same per-offset-pass idea `raster-tile-traversal.ts` already uses for XYZ tile frustum culling, just in lng/lat degrees instead of common-space pixels.

## Known gap (not yet fixed, currently dormant)

`getTileMetadata`'s per-tile `bbox` and the constructor's dataset-level `wgs84Bounds` still call `transformBounds` **once over the whole (unsplit) tile/dataset** — for a genuinely crossing tile this still computes a bogus ~360°-wide box. It hasn't broken anything in `antimeridian-example` because that box only gates tile *selection*, and a single-tile (1×1 grid) dataset's small-dataset path in `getTileIndices` bypasses that check entirely. A multi-tile crossing mosaic would hit this. Proper fix: split `projectedBounds` at the same `uCut`-derived source-CRS x, reproject each piece with its own (now-fixed) `forwardReproject`, and union — mirrors what the mesh/debug-outline fixes already do, just not implemented for these two call sites yet.

## Verified

- Real-data isolated test (`GeoTIFF.fromUrl` → `geoTiffToDescriptor`, no STAC) against the actual DEP GeoMAD antimeridian item.
- `examples/antimeridian-example`: renders both pieces with real pixel data, correct debug-overlay boxes, no more "belting the earth."
- `examples/antimeridian-mosaic-multi-example`: same two DEP GeoMAD items composited R/G/B through `MosaicLayer` + `MultiCOGLayer` (the shape real usage actually needs) instead of a single-band `COGLayer`; renders both items with a continuous, untorn coastline straddling the antimeridian reference line.
- 151/151 unit tests pass (`packages/deck.gl-raster`), including new coverage for the per-point threshold fix and its exact-seam-corner regression case.
- 25/25 unit tests pass (`packages/deck.gl-geotiff`), including new coverage for the mosaic world-copy fix (shifted-copy lookup, no-op when not needed, dedup across passes).
