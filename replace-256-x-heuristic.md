# Replacing the `x < 256` antimeridian heuristic

## Problem

An antimeridian-crossing tile gets cut into two pieces (west/east), each meshed independently. Every
mesh vertex is reprojected through proj4, which always normalizes longitude to `(−180°, 180°]` — so
a vertex whose true position is just past the seam comes back wrapped to the *opposite* edge of the
map. Each piece needs its wrapped vertices corrected back onto a single contiguous mesh.

The current correction, `unwrapCommonSpaceX` (`packages/deck.gl-raster/src/raster-tileset/antimeridian-cut.ts`):

```ts
export function unwrapCommonSpaceX(x: number, tileSize: number): number {
  return x < tileSize / 2 ? x + tileSize : x;
}
```

is a **magnitude test against a fixed midpoint** (256, half the world). It works for a normal,
narrow tile. It breaks for a piece wide enough that one of its own, legitimately-placed points
crosses that same 256 line without ever having wrapped at all — the test can't tell "this point
wrapped around the seam" apart from "this point is just far from the seam," because both look
identical once reduced to a single magnitude comparison. The result is a torn mesh, silently.

## Solution

Correct each point against a **reference computed from that point's own position**, instead of a
single fixed constant for the whole piece.

`antimeridianCut` (`antimeridian-cut.ts`) already computes, for every tile, the true continuous
longitude range of each piece — via `unwrapEastLng`, the same "west > east marks a crossing, add
360°" comparison GeoJSON (RFC 7946 §5.2) uses for bboxes. That range is exact and doesn't degrade
with width; it's how `antimeridianCut` locates the seam (`uCut`) in the first place, for a piece of
*any* size.

Reuse it. For a sample point at parameter `t ∈ [0,1]` along a piece, linearly interpolate between the
piece's two already-known corner longitudes to get an **expected** longitude for that point — pure
arithmetic on two numbers already in hand, no extra proj4 call. Then snap the point's real (wrapped)
projected longitude to the representative nearest that expected value:

```
corrected = actual + round((expected − actual) / 360) * 360
```

**In plain terms:** the old test asks one global question — "is this point in the left half of the
whole map?" — and treats "yes" as proof it wrapped. But a wide piece can have points that are
genuinely, correctly in the left half without anything having wrapped at all; the test can't tell
the two apart because it only ever looks at one number in isolation. The new test asks a different,
local question instead — "is this point roughly where I'd expect it, given where it sits *within this
piece*?" — and only nudges it by a full world-width if the answer is no. Because the expectation
moves with the point instead of sitting fixed at one spot, it stays a useful check no matter how wide
the piece is.

**Worked example.** Take a tile whose corners are native lng −100° and +190° (un-normalized, so
west < east as usual) — crossing the seam at 180°, `uCut = (180−(−100))/(190−(−100)) = 280/290`. The
west piece spans native lng −100° to 180°: 280° wide, entirely inside proj4's normal `(−180°,180°]`
range, so *nothing in this piece ever wraps at all*. Take a point near its far edge, native lng −90°
(`t = 10/280 ≈ 0.036`). proj4 returns it unchanged, −90° (no wrap — there's nothing to correct) →
common-space `x ≈ 128`. The old test only looks at that `x`: `128 < 256`, so it "corrects" a point
that was already correct, shifting it a full world-width to `x ≈ 640` and tearing the mesh — the
heuristic doesn't require an actual wrap to misfire, just a piece wide enough to have legitimate
points below the midpoint.

The new test instead interpolates an expected value for this point: `expected = −100 + 0.036×280 =
−90°` — matching the actual value exactly. `round((−90 − (−90))/360) = 0`, so `corrected = −90°`,
unchanged. It correctly recognizes nothing needs fixing, because its reference was computed from
*this point's own position in the piece*, not a fixed line drawn through the middle of the world.

## Why this is the most general and robust solution

**It has no artificial width limit.** The old test's ±180°-from-256 limit comes entirely from using
one fixed reference for an entire piece — any single, fixed reference (256, a corner, anything) can
only disambiguate up to half a period away from itself, and that's true regardless of how the
reference is chosen or where the test is performed (common-space, longitude-space, doesn't matter —
same wall, different name). A *per-point* reference doesn't have this problem: it's derived from
where that specific point actually sits, so it stays close to the true value everywhere across the
piece, no matter how wide the piece is.

**The only remaining constraint isn't a new one.** The interpolation is only meaningful if the
piece's two corner longitudes describe a real, non-self-overlapping span — i.e. the tile's total
width is under 360°. That's not a limitation this fix introduces or fails to solve: data ≥360° wide
already has two pixels claiming the same real-world longitude, which is invalid regardless of how
it's rendered. No correction, however general, can produce a "correct" placement for data that
doesn't have one. This fix's domain of validity is exactly the domain of valid input.

**It reuses machinery that's already trusted and already width-independent.** `unwrapEastLng` and
the corner data it produces are the *detection* step, used today for cut location and (via
`normalizeSourceBbox`) Mosaic source indexing — both already work at any width, because comparing
two known longitudes against each other never degrades the way a magnitude test against a fixed
constant does. This fix doesn't add a new mechanism; it extends the reach of the one already proven
correct at the corners down to every interior point.

**It doesn't reintroduce the fragility of a rejected prior approach.** A generic phase-unwrap that
walks samples in spatial order and accumulates an offset from neighbor to neighbor (tried and
rejected as PR #374) is order-dependent, and one bad sample corrupts everything downstream of it.
This fix computes each point's reference independently, straight from validated corner geometry —
no walk order, no accumulated error, no dependency between points.

**It keeps the existing architecture.** No change to the cut-into-two-pieces design, no change to
where `RasterReprojector` runs or what it needs — only the per-point correction step inside a piece
that's already known to be isolated on one side of the seam.

## Prior art already using this idiom (detection only, not placement — until now)

- **`unwrapEastLng(westLng, eastLng)`** — the GeoJSON west>east idiom itself, used by
  `edgeUCut`/`antimeridianCut` to detect a crossing and locate the seam.
- **`normalizeSourceBbox`** (`packages/deck.gl-geotiff/src/mosaic-layer/mosaic-layer.ts`) — the same
  idiom applied to a `MosaicLayer` source's bbox before Flatbush indexing.

Both are one-shot, corner-level comparisons — this fix is the same idea, applied per interior point
instead of once at the corners.

## Before implementing

- **`antimeridianCut`'s return type needs extending** — currently just `{ uCut }`; the render and
  traversal code need each piece's corner longitudes too, to interpolate against. Natural to add
  `westLng`/`unwrappedEastLng` (already computed internally) to `AntimeridianCut`.
- **Mesh vertices for a very wide piece will legitimately land outside `[0, 512]`** (into
  neighboring world copies) — expected, and already how deck.gl's repeat rendering works via
  `worldOffset` translation. `MAX_MAPS = 3` in `raster-tile-traversal.ts` (and the equivalent in
  `mosaic-tileset-2d.ts`) may need to scale with piece width for a genuinely extreme piece rather
  than staying a fixed constant.
- **Validate the interpolation assumption against a pathological CRS.** The interpolated reference
  only needs to land within 180° of the true value to disambiguate correctly — a low bar for any
  reasonably-behaved projection over one tile's extent — but this hasn't been stress-tested outside
  the straight/vertical-or-slanted-cut MVP scope this project already targets.
- **`MAX_PIECE_SPAN_DEG` (already implemented, `antimeridian-cut.ts`)** — its role changes from
  "reject any piece ≥170° wide" to a check against genuine self-overlap (total tile width ≥360°);
  the threshold should move accordingly rather than being dropped outright.

## Appendix: two fixed-reference variants considered and rejected

Both were tried first, before landing on the per-point version above — kept here because they're the
reasoning that rules out the "just use the GeoJSON idiom directly" instinct.

**Piece-relative fixed reference.** Compare each point against its own piece's known corner instead
of a bare constant:

```ts
function unwrap(x, reference, worldWidth) {
  let corrected = x;
  while (corrected - reference > worldWidth / 2) corrected -= worldWidth;
  while (corrected - reference < -worldWidth / 2) corrected += worldWidth;
  return corrected;
}
```

For the west piece (`reference = 512`): `x - 512 < -256 ⟺ x < 256` — identical to the current test.
Same for east (`reference = 0`). Not a coincidence: for this geometry, the only legitimate *fixed*
reference for each piece is 0 or 512, both literally the antimeridian viewed from that piece's own
frame — so an explicit reference-relative version collapses to the exact arithmetic already shipped.

**Unwrap in longitude space before the linear rescale.** EPSG:3857's `x` is exactly linear in
longitude, so try correcting the longitude (via the `unwrapEastLng` comparison) before that linear
step instead of after. This looked promising enough on a first pass to conclude it might extend the
safe range to just under 360° — worth keeping the mistake visible, since it's the natural way to
talk yourself into thinking this direction works. The error: treating "±180° around the reference"
as the piece's *whole* width budget (360° total), when the reference is one *edge* of the piece, not
its center — the piece only extends away from that edge in one direction, so the usable budget in
that direction is still capped at just under 180°. Moving the correction earlier doesn't change how
much information the projection already threw away — same limit, different domain.

Both share the same root cause: a single, fixed reference for the whole piece can only disambiguate
±180° around itself, regardless of how cleverly the reference is chosen or which domain the
comparison happens in. That part of the reasoning holds. What doesn't hold is that a fixed reference
was the only option — see "Solution" above.
