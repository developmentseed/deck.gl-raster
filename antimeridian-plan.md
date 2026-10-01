# Antimeridian: mesh-driven unwrap + clip (any seam shape)

## Context

Today `antimeridianCut` (`packages/deck.gl-raster/src/raster-tileset/antimeridian-cut.ts`) estimates where the seam is from 4 corner longitudes and only accepts **vertical** cuts. Any other crossing falls back to one full mesh and diverges (#366). The approach is replaced with two CRS-agnostic operations, so each seam shape becomes a test case rather than a code path:

1. **Unwrap in the reprojector.** Each new mesh vertex's output x snaps to the copy nearest its parent triangle's *interpolated* x. Delatin already computes that value for its error check. The interpolation is off only by reprojection error, which is far inside the ±256 (180°) snap tolerance.
2. **Clip the finished mesh at x = k·512.** Clip the unwrapped mesh where it crosses each world boundary, and shift each part back into [0, 512]. That is the actual discontinuity, so the cut is exact for vertical, slanted, curved, and polar seams. The result is one mesh and one layer per tile, with no west and east pieces.

Fixtures (`fixtures/geotiff-test-data/rasterio_generated/fixtures/`): `antimeridian.tif` (vertical), `antimeridian_utm60.tif` (curved), `antimeridian_360.tif` (world-spanning). The slanted fixture is added below.

## Step 0: verify single-mesh world-copy visibility first

Before building anything, check whether deck.gl draws a mesh with x in [500, 530] when zoomed tight on the east side (x ≈ 14, only the offset-0 subViewport). If it does, step 3's clip only needs splitting with no shift. Expected: it does not, so the clip and shift are needed. Do a throwaway check in `examples/cog-basic` by hard-coding a +512 shift on a normal tile.

## Changes

### 1. `packages/raster-reproject/src/delatin.ts`: optional periodic x
- Add a constructor option `wrapX?: number` (the period; deck.gl-raster passes `TILE_SIZE`). When it is unset, behavior is unchanged for other consumers.
- Add a helper `snapToCopy(x, ref, period) = x + Math.round((ref - x) / period) * period`, exported for the traversal to reuse.
- `_findReprojectionCandidate`: store the max-error sample's interpolated `outSampleX` in a new `_candidatesOutX[t]`, next to `_candidatesUV`.
- `_addPoint(u, v, refX?)`: if `wrapX` and `refX` are both set, snap the exact output x to `refX`. `_step` passes `_candidatesOutX[t]`.
- **Seed vertices have no parent triangle.** Unwrap each one along the path from the previous seed vertex. Bisect the uv segment and snap each sample to the one before it, until every step is under `period / 4` (with a depth cap). This is needed for a −180..180 tile, whose corners both land on x = 0 ≡ 512. Without it, they collapse.
- The error check needs `inverseReproject` to accept unwrapped x outside [0, 512). See step 2.

### 2. `packages/deck.gl-raster/src/raster-tileset/raster-tileset-2d.ts`
- `_unprojectPosition` becomes exact for unwrapped x without being told about the CRS: `lng = cx · 360 / 512 − 180` (no wrap), `lat` from `cy` (Mercator inverse), then `descriptor.projectFrom4326(lng, lat)`. For a 4326 source, this passes un-normalized longitudes straight through (e.g. −204). For projected sources, proj4's `adjlon` handles longitudes past ±180.
- Delete `_antimeridianCut`, `_westReprojection`, `_eastReprojection`, `buildPieceReprojection`, and the cut detection in `getTileMetadata`.
- **World-spanning:** tiles are boundless, so the 36×2 overview tile of `antimeridian_360` nominally spans 640°. Clip the seed to the tile's valid data rect by mapping `descriptor.projectedBounds` through the tile's `inverseTransform`. Intersect it with the existing ±85.051° band in `web-mercator-clamp.ts`, which gains a `uvRect` param. This stops the reprojector from meshing padding, which would overlap itself after unwrapping.

### 3. Mesh clip, in `reprojectorToMesh` (deck.gl-raster)
- Given `wrapX`, find each triangle's `k = floor(x / 512)` range. If it falls in a single copy, shift by `−k·512`. Otherwise, clip the triangle against each `x = k·512` line (Sutherland–Hodgman against vertical lines). Fan-triangulate each part; the parts are convex. Interpolate the new vertices' uv and y linearly along the cut edge, so texture mapping matches the unclipped mesh exactly. Shift each part into [0, 512]. The 64-bit high/low position split runs after this, unchanged.
- Debug triangles (`renderDebugLayer`) read `exactOutputPositions`. Draw them from the clipped mesh instead, or accept that the debug wireframe is unclipped.

### 4. Traversal: `packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts`
- `_getGenericBoundingVolume`: drop `antimeridianCut` and `unwrapCommonSpaceX`. Unwrap the 9 reference points with `snapToCopy`, each against its already-unwrapped grid neighbour (the same bisect-along-edge rule as the seed). That gives one tight box straddling 512, as now.
- Dataset bounds (~L990): unwrap the densified dataset edge the same way.
- Keep the `subViewports != null` world-copy gate fix.

### 5. Render and debug consumers
- `raster-tile-layer.ts`: delete `_renderAntimeridianTile`. Every Web Mercator tile goes through `_renderNormalTile`, with `wrapX: TILE_SIZE` passed through a new `RasterLayer` prop to the reprojector and `reprojectorToMesh`.
- `layer-utils.ts` `renderDebugTileOutline` and `deck.gl-geotiff/src/multi-cog-layer.ts` (~L866): delete the west/east piece outline branches (`pieceBoxPath`, `pieceBoxWgs84`, `unwrapBoxLngs`). Draw the plain corner outline in lng/lat with `PathLayer`'s `wrapLongitude: true`.
- Delete `antimeridian-cut.ts` and its `_unwrapEastLng` export, **except** where `mosaic-layer.ts` `normalizeSourceBbox` uses `unwrapEastLng`. Move that one-liner into `mosaic-layer.ts`.

### 6. Fixtures and example
- Add a slanted fixture to the geotiff-test-data submodule as `antimeridian_rotated.py`: 4326, `Affine.translation(-204, 24) * Affine.rotation(20) * Affine.scale(1, -1)`, 42×42. Generate its `.tif` and `_info.md`.
- Add "vertical" and "rotated" entries to `examples/cog-basic/src/App.tsx`, next to the uncommitted UTM60 and 360° entries.

### 7. Docs
- Rewrite the "Approach", "Seam handling", and "Locating the cut" sections of `dev-docs/specs/2026-05-27-antimeridian-crossing-tile-design.md` around unwrap-plus-clip. Keep cut-in-two as history: it was the vertical-only MVP.

## Tests

Run the tests with `pnpm vitest` in `packages/raster-reproject` and `packages/deck.gl-raster`.

- `raster-reproject`:
  - With `wrapX` unset, the output is identical to today's.
  - With `wrapX` set and a wrapping projection mock: the mesh converges, and adjacent vertices never jump more than 256. Test vertical, slanted (rotated affine), curved (UTM-like nonlinear), and a −180..180 tile, which must not collapse.
  - `snapToCopy` boundary cases.
- Mesh clip:
  - Total area is preserved.
  - Every position is in [0, 512].
  - At a seam-cut vertex, uv matches the lerp.
  - No triangle straddles a boundary.
- `raster-tileset-2d-antimeridian.test.ts`: rewrite against the new behavior. For each of the 4 shapes, cover the 4326 identity mock and the wrapping (projected) mock:
  - The mesh converges with no `did not converge` warning.
  - `inverseReproject(forwardReproject(p)) ≈ p` after the snap.
  - World-spanning overview tile: the seed is clipped to `u ≤ 36/64`.
- Traversal: a bounding volume for vertical, slanted, and curved tiles is one tight box around 512.
- **Visual** (`examples/cog-basic`, `pnpm dev`), all 4 fixtures:
  - Continuous across ±180°.
  - No seam gap.
  - Visible when zoomed tight on either side alone.
  - Before/after against the current branch for `antimeridian.tif` and the 3832 DEP COG.

## Risks / out of scope
- The refinement snap needs each coarse triangle's interpolation error to be under 180°. A seed triangle spanning a wildly nonlinear region, such as a polar stereographic tile covering the pole, could violate this. Mitigation: the seed path-unwrap already densifies; add a `ponytail:` note and seed a denser grid if a polar fixture shows it.
- Globe view is unchanged; it doesn't pass `wrapX`.
