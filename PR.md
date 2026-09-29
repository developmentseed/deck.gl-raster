This PR aims to extend upon and test the [open antimeridian PR](https://github.com/developmentseed/deck.gl-raster/pull/576). I am using tiled Digital Earth Pacific data that is in PDC (EPSG:3832). One column of tiles span the antimeridian.

The above linked PR sets up a good approach in dev-docs/specs/2026-05-27-antimeridian-crossing-tile-design.md. This PR continues this split-in-two mesh design. This PR also aims to follow https://www.gadom.ski/antimeridian/latest/ where relevant.

This PR has significant overlap with my earlier PR https://github.com/developmentseed/deck.gl-raster/pull/639, and should replace it.

Technical details:
- RasterTileLayer._renderAntimeridianTile emits two RasterLayers (west/east), each seeded via triangulateRectangle from its own UV sub-domain, sharing one texture — exactly the "split in the sublayer factory, everything else keeps its single-mesh contract" design.
- Cut detection matches the MVP's stated scope. antimeridianCut/edgeUCut — vertical-only, rejects slanted (U_EPSILON tolerance), falls back to full mesh otherwise. Matches the code's own docstring; the design doc's broader "vertical and slanted" scope claim was already aspirational in #576, not something this branch touched either way.

- All 3 of kylebarron's review comments on antimeridian-cut.ts are addressed:
  - U_EPSILON now has a docstring
  - edgeUCut was hoisted to a top-level function
  - antimeridianCut's docstring now explicitly says general antimeridian handling should eventually be supported, just isn't yet
- Test plan items present: cut-location unit tests (antimeridian-cut.test.ts), piece-reprojection unit tests (raster-tileset-2d-antimeridian.test.ts), and the cog-basic dev-only antimeridian.tif fixture entry from #576 is still intact and untouched.

- One real discrepancy — the design doc is now stale. The doc's "Seam handling" section describes the fix as: "local to the wrapped (negative-side) piece only... if the projected X comes back positive, subtract one world-width." That's the original #576 mechanism, and it's what this branch replaces. It was wrong ("a single constant-per-piece shift is simply wrong at the piece's own boundary corner, which coincides with the other piece's edge and needs no shift at all"). The actual code now applies one symmetric per-point test to both pieces, in common-space, post-projectPosition — not piece-specific, not a native-CRS sign check. Functionally correct and tested (including the exact-seam-corner regression case), but the design doc's prose still describes the old mechanism. Need to update the doc.

I have made a frankenstein monster of my 3 PRs to test, and they work well together for my needs (a combo of MosaicLayer, MultiCOGLayer that spans the antimeridian and needs nearest sampling). https://github.com/willjnz/deck.gl-raster/tree/willjnz/frankenstein. This combines:
- https://github.com/willjnz/deck.gl-raster/tree/willjnz/antimeridian-crossing-fixes
- https://github.com/developmentseed/deck.gl-raster/pull/640
- https://github.com/developmentseed/deck.gl-raster/pull/639


Remaining problems:
- when zoomed in, but the am is no longer visible, the 066 right part of the tile does not render. when zoomed in far around -179.9 or +180.1, the am-crossing tile does not render. this stops rendering as soon as the 180 degree is no longer visible (but the tile's data should still render). make a plan to fix this. i guess it is to do with tile traversal. this issue is present in both am examples
