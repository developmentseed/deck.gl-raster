# Antimeridian-crossing tile disappears when zoomed away from the seam

## Problem

In `antimeridian-example`, once zoomed in tight on one side of the crossing tile — far enough
that ±180° itself scrolls out of view — the tile stopped rendering entirely, even though its data
footprint was still on screen. Reappeared as soon as ±180° came back into view.

## Root causes (three, in `packages/deck.gl-raster/src/raster-tileset/`)

The traversal/culling code (`raster-tile-traversal.ts`) had zero awareness of the antimeridian
split that the render path (`raster-tileset-2d.ts`'s `buildPieceReprojection`) already handled.

1. **Malformed per-tile bounding volume.** `_getGenericBoundingVolume` reprojects 9 reference
   points per tile with no antimeridian correction. For a crossing tile, some points land near
   `x≈0` and others near `x≈512` (proj4 wraps ±180° during the forward-to-3857 projection) — one
   `OrientedBoundingBox` fit over that scattered cloud doesn't represent "a thin sliver at the
   seam," so culling was unreliable except by accident (the old box was wide enough to overlap
   the frustum only when the seam itself was in view).
2. **Malformed dataset-level bounds.** The same problem, one level up: `wgs84Bounds` (used as an
   `insideBounds` pre-filter, checked before frustum culling on every tile) is derived from
   `descriptor.projectedBounds` via a naive min/max over densified samples — for a crossing
   dataset this produces numbers that don't correspond to the real west/east corners either.
   Once (1) was fixed, this mismatch caused a *new* failure: the corrected tile box and the
   uncorrected dataset box only touched at `x=512` instead of overlapping, so the tile was
   rejected at the bounds-check stage, at every zoom, before culling even ran.
3. **Mesh rendered in the wrong world copy.** `buildPieceReprojection` built one shared
   reprojection for both the west and east pieces, always shifting the "wrapped" half so both
   pieces sit in a single combined frame near `x≈512`. That's correct when both pieces are
   visible together (they need to connect seamlessly), but wrong when only the east piece is in
   view: its mesh was still drawn at `x≈512`, a full world away from wherever the camera actually
   was — selected (fetched) but never on screen, since deck.gl only draws the `worldOffset` camera
   passes the viewport's own current bounds actually produce (`offset=0` is always one of them;
   `offset=-1` etc. only exist when the viewport itself currently straddles a seam).

## Fix

- **`antimeridian-cut.ts`**: added `unwrapCommonSpaceX(x, tileSize)` — the shared per-point
  correction (`x < tileSize/2 → x + tileSize`), extracted from `buildPieceReprojection`'s inline
  version so both the render path and the traversal use the same tested logic.
- **`raster-tile-traversal.ts`**:
  - `_getGenericBoundingVolume` now detects crossing via `antimeridianCut` (same corner-longitude
    check `raster-tileset-2d.ts` already used) and applies `unwrapCommonSpaceX` to the sampled
    reference points before fitting the bounding volume — fixes root cause 1.
  - `getTileIndices` now separately detects whether the *dataset* crosses (from
    `descriptor.projectedBounds`' real corners, not the lossy `wgs84Bounds`) and recomputes the
    `bottomLeft`/`topRight` common-space bounds from each corner's own longitude — fixes root
    cause 2. (Patching the already-mixed-up `wgs84Bounds` min/max in place doesn't work — the two
    numbers no longer correspond to "west corner" and "east corner" individually, so it has to be
    rebuilt from the real corners.)
  - The world-copy offset-pass gate changed from `subViewports.length > 1` to
    `subViewports != null`, so a tile whose corrected box only overlaps the frustum at a non-zero
    offset can still be found once zoomed in tight (rather than being un-findable simply because
    the *viewport* itself no longer straddles a seam).
- **`raster-tileset-2d.ts`**: `buildPieceReprojection` now takes a `"west" | "east"` piece
  argument and applies a *mirrored* correction per piece instead of one shared bundle — fixes root
  cause 3. West keeps the existing `+TILE_SIZE`-if-wrapped rule (already correct, since its raw
  values never fall below `TILE_SIZE/2`); east now does the opposite (`-TILE_SIZE` if
  `x ≥ TILE_SIZE/2`, a no-op for its own interior), so it renders at its own natural near-`0`
  position instead of being forced next to the west piece. deck.gl's own repeat-rendering already
  draws whichever camera passes actually exist each frame, so each piece just needs to be at its
  true position — no manual cross-piece shift needed, and the two pieces still meet up correctly
  when both are in view (each gets independently repeat-rendered into the copy the other is in).
- **`layer-utils.ts`**: `renderDebugTileOutline` was using the shared west bundle for *both*
  pieces' debug boxes (a leftover of the old design) — updated to use each piece's own
  reprojection, matching how they now actually render.

## Verification

- `pnpm --filter @developmentseed/deck.gl-raster test` — 151/151 passing, including updated
  `raster-tileset-2d-antimeridian.test.ts` cases for the new mirrored east-piece behavior.
- Manually confirmed in `antimeridian-example`: crossing tile (image + debug outline, both
  pieces) now stays visible when zoomed into either side alone, away from ±180°.

## Known follow-up

- `raster-tile-traversal.ts` still has temporary `console.warn('[AM-DEBUG] ...')` logging (gated
  to near-seam tiles) left in from live debugging — remove before shipping.
- Not yet ported to the Mosaic/MultiCOG path (`mosaic-tileset-2d.ts`) — out of scope for this
  pass, which was deliberately limited to `antimeridian-example`.
