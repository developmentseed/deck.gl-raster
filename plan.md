

# Plan: render an antimeridian-crossing COG as two parts, split at `uCut`

## The two things actually broken

**1. Bbox: a crossing tile can't have one bbox.**
`getTileMetadata`'s `bbox` (line ~410, `transformBounds(projectTo4326, ...projectedBounds)`) reprojects the *whole* tile rectangle in one shot. For a crossing tile this naively spans ~360° (or, with `wrapPeriod`, silently violates the `[-180°,180°]` / west<east assumption every bbox consumer makes — which is why the tile stopped rendering at all). A single bbox cannot represent two disjoint rectangles. Fix: compute **two** bboxes, one per piece, split at `uCut` — not a wrap/unwrap trick.

**2. Mesh: `buildPieceReprojection`'s shift is applied at the wrong stage for a projected source CRS.**
`lngShift = -Math.round(pieceMidLng / 360) * 360` is added to `forwardTransform`'s *output* — but `forwardTransform` is the raw geotransform (pixel → source-CRS native units). For the PR's own dev fixture (source CRS = EPSG:4326), native units *are* degrees, so shifting by `k·360` there is correct. For our real case (EPSG:3832, native units = **meters**), adding `-360` (meant as `-360°`) to a meters value is a unit mismatch — it nudges the east piece by 360 *meters*, not by one world-copy. The antimeridian discontinuity for a projected CRS doesn't come from the geotransform at all — it comes from `projectTo4326`/`projectTo3857` normalizing their *output*. So the shift has to be applied **after** projection (in common space / 3857 meters), not before it (in source-CRS space).

The fix is the same "world-copy offset" concept this codebase already uses for pan-across-antimeridian traversal (`worldOffset * TILE_SIZE` in `raster-tile-traversal.ts`) — just applied per-piece at tile-build time instead of per-frame at traversal time.

## Plan

1. **Bbox split.** In `getTileMetadata`, when `_antimeridianCut` is defined: instead of one `transformBounds` call over the full `projectedBounds`, split `projectedBounds` at the source-CRS x matching `uCut` (`cutX = left + uCut * (right - left)`), and call plain `transformBounds` (no wrap) once per piece: `[left, bottom, cutX, top]` and `[cutX, bottom, right, top]`. Each piece is monotonic by construction — no wrap logic needed anywhere.
2. **Reconcile west/east bbox with each piece's mesh frame.** The west bbox comes out ordinary (e.g. `[179.97°, …, 180°]`). The east bbox, reprojected with the *stock* (unshifted) `projectTo4326`, comes out on the wrong side (`[-180°, …, -179.17°]`) — adjacent to the west bbox only in wrap-around terms, not numerically. It needs the same `+1 world` shift as its mesh piece so the two bboxes sit in one continuous frame and union correctly (`[179.97°, …, 180.83°]`).
3. **Move the mesh shift to the right stage.** Change `buildPieceReprojection` to stop shifting `forwardTransform`'s output. Instead, wrap `forwardReproject`/`inverseReproject` (currently just `this.projectPosition`/`this.unprojectPosition`) to add/subtract one world-copy (`TILE_SIZE` in common space, equivalently `EPSG_3857_CIRCUMFERENCE` in 3857 meters) for the east piece. Decide "does this piece need a world shift" from the piece's *already-computed WGS84 mid-longitude* (degrees), not from raw source-CRS units — this makes it correct for both the 4326-native-unnormalized case and the projected/GeoJSON-flipped case with one code path.
4. **Reuse for bbox.** Once (3) exists, step 1/2's per-piece bbox can reproject through the *same* per-piece `forwardReproject`, guaranteeing bbox and mesh always agree — no separate shift computation to keep in sync.
5. **Dataset-level `wgs84Bounds`** (constructor, line ~221): same treatment, once the per-tile case is confirmed working in the browser. Lower priority — only matters when the dataset's own outer rectangle (not just one internal tile) crosses.

## Non-goals

- Slanted/curved cuts, multi-crossing datasets (#575).
- Don't touch tests until this renders correctly in the browser.
