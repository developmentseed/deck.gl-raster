This PR aims to test the [open antimeridian PR](https://github.com/developmentseed/deck.gl-raster/pull/576) and make it functional. I am using tiled Digital Earth Pacific data that is in PDC (EPSG:3832) which passes the vertical (not slanted) cut condition. One column of tiled COGs span the antimeridian.

The [above linked PR](dev-docs/specs/2026-05-27-antimeridian-crossing-tile-design.md) sets up a good approach. This PR continues this split-in-two mesh design. This PR also aims to follow https://www.gadom.ski/antimeridian/latest/ where relevant.

This PR has significant overlap with my earlier PR https://github.com/developmentseed/deck.gl-raster/pull/639, and should replace it.

This PR has 2 examples, a simple COGLayer spanning the antimeridian, and a MosaicLayer/MultiCOGLayer example. 


#### Technical details:
- RasterTileLayer._renderAntimeridianTile emits two RasterLayers (west/east), each seeded via triangulateRectangle from its own UV sub-domain, sharing one texture — exactly the "split in the sublayer factory, everything else keeps its single-mesh contract" design.
- Cut detection matches the MVP's stated scope. antimeridianCut/edgeUCut — vertical-only, rejects slanted (U_EPSILON tolerance), falls back to full mesh otherwise. Matches the code's own docstring; the design doc's broader "vertical and slanted" scope claim was already aspirational in #576, not something this branch touched either way.

- All 3 of kylebarron's review comments on antimeridian-cut.ts are addressed:
  - U_EPSILON now has a docstring
  - edgeUCut was hoisted to a top-level function
  - antimeridianCut's docstring now explicitly says general antimeridian handling should eventually be supported, just isn't yet
- Test plan items present: cut-location unit tests (antimeridian-cut.test.ts), piece-reprojection unit tests (raster-tileset-2d-antimeridian.test.ts), and the cog-basic dev-only antimeridian.tif fixture entry from #576 is still intact and untouched.

- One real discrepancy — the design doc (`2026-05-27-antimeridian-crossing-tile-design.md`) is now stale on seam handling:
  - **What the doc says**: its "Seam handling" section describes the fix as "local to the wrapped (negative-side) piece only... if the projected X comes back positive, subtract one world-width." That's the original #576 mechanism.
  - **Why it's wrong**: a single constant-per-piece shift breaks at the piece's own boundary corner, which coincides with the other piece's edge and needs no shift at all.
  - **What this branch does instead**: one symmetric per-point test applied to both pieces, in common-space, after `projectPosition` — not piece-specific, not a native-CRS sign check.
  - **Status**: fixed — `dev-docs/specs/2026-05-27-antimeridian-crossing-tile-design.md`'s "Seam handling" section now describes the shipped symmetric mechanism (old text kept, struck through, for history), and its "Traversal" bullet, "Edge cases", and "Test plan" sections are updated to match. Also added a new "Locating and selecting a crossing tile in the traversal" section documenting the fix described below.

- MosaicLayer/MultiCOGLayer support: `normalizeSourceBbox` (mosaic-layer.ts) unwraps a GeoJSON-flipped source bbox (RFC 7946 §5.2: `minX > maxX` marks a crossing) onto a continuous frame before it's indexed into Flatbush, so the spatial index, the priority-queue distance calculation, and `MosaicTileset2D`'s own viewport search all agree on one bbox per source. `MultiCOGLayer`'s debug overlay (`_renderDebugLayers`/`pieceBoxWgs84`) splits into matching west/east boxes for a crossing tile — `MultiCOGLayer extends RasterTileLayer`, so the actual mesh-splitting/reprojection path is shared automatically; only the debug-outline drawing (which works in plain lng/lat, not common-space) needed its own antimeridian handling.

- This PR also covers visualising just one side of the AM-split COG/Mosaic. An earlier version of this PR would not show the right/east side of an am-split texture, if the left/west side was not in view. Root cause: `raster-tile-traversal.ts`'s frustum-culling traversal had zero antimeridian awareness, three compounding defects:
  1. `_getGenericBoundingVolume` sampled 9 reference points per tile with no antimeridian correction — for a crossing tile some land on each edge of common space, producing a bounding volume wide enough to be found only by accident (when the seam itself was in view). Fixed by extracting the wrap-correction already used in `buildPieceReprojection` into a shared `unwrapCommonSpaceX(x, tileSize)` helper (`antimeridian-cut.ts`) and applying it before fitting the box.
  2. Once (1) was fixed, the dataset-level `insideBounds` pre-filter in `getTileIndices` — built from the same lossy min/max `wgs84Bounds` — only *touched* the now-tight per-tile box at the seam instead of overlapping it, rejecting the tile at every zoom. Fixed by recomputing the dataset's own bounds from its real corner longitudes when the dataset itself crosses, instead of patching the already-mixed-up min/max.
  3. `buildPieceReprojection` built one shared reprojection for both pieces, always anchoring both near common-space `x≈512` — correct when both pieces are in view together, wrong once only the east piece is in view (its mesh stayed a full world away from the camera, selected but never drawn on screen). Fixed by mirroring the correction per piece so each renders at its own natural position; deck.gl's existing repeat-rendering (`subViewports`) already draws whatever world copies the camera needs.
  - The world-copy offset-pass gate also changed from `subViewports.length > 1` to `subViewports != null` in both traversal files — the former only tests whether the *viewport itself* currently straddles a seam, not whether a tile's (or, for `MosaicTileset2D`'s Flatbush-based, lng/lat bbox search in `mosaic-tileset-2d.ts`, a source's) own position needs a shifted pass to be found once zoomed in tight to one side alone.

#### Test PR:
I have made a frankenstein monster of my 3 PRs to test, and they work well together for my needs (a combo of MosaicLayer, MultiCOGLayer that spans the antimeridian and needs nearest sampling). https://github.com/willjnz/deck.gl-raster/tree/willjnz/frankenstein. This combines:
- https://github.com/willjnz/deck.gl-raster/tree/willjnz/antimeridian-crossing-fixes
- https://github.com/developmentseed/deck.gl-raster/pull/640
- https://github.com/developmentseed/deck.gl-raster/pull/639
