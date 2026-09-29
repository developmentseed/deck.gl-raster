/**
 * WGS84 longitudes of a tile's four corners, as returned by
 * `descriptor.projectTo4326(corner)[0]`. A crossing edge is accepted in
 * either of two encodings:
 *  - **Native un-normalized**: for an identity 4326→4326 source whose
 *    `ModelTiepoint` sits past ±180°, proj4 does not renormalize, so west <
 *    east always and a crossing edge shows up as e.g. `(−204, −162)`.
 *  - **GeoJSON-flipped** (RFC 7946 §5.2): for any *projected* source, proj4's
 *    inverse projection normalizes its output to (−180°, 180°], so a
 *    crossing edge instead shows up with west > east, e.g.
 *    `(179.97, −179.17)` — the same convention the GeoJSON spec uses for an
 *    antimeridian-crossing bbox.
 * A non-crossing edge always has west < east.
 */
export interface CornerLongitudes {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

/** A vertical antimeridian cut in a tile's UV space. */
export interface AntimeridianCut {
  /** UV u-coordinate (0..1) where the tile crosses ±180°. */
  uCut: number;
}

/**
 * Tolerance for treating the top- and bottom-edge crossings as the same u
 * (i.e. the cut is vertical). Crossings further apart than this are rejected as
 * slanted.
 */
const U_EPSILON = 1e-6;

/**
 * Maximum longitude span (degrees) either piece may have after the cut.
 *
 * `unwrapCommonSpaceX`'s per-point correction (and `buildPieceReprojection`'s
 * matching per-vertex correction) assumes a piece's own interior never
 * legitimately crosses the common-space halfway point (x = tileSize/2,
 * i.e. the piece spans less than 180° of longitude): any point found past
 * that mark is treated as a wrapped artifact of the seam and shifted a full
 * world-width. For a piece ≥ 180° wide that assumption breaks — a point can
 * legitimately cross the halfway mark without having wrapped at all, and
 * gets wrongly shifted, tearing the mesh. There is no simple per-point or
 * per-piece fix for this (a true fix needs a continuous per-point unwrap,
 * which doesn't generalize to arbitrary source CRSs — see the antimeridian
 * design doc's "Locating and selecting a crossing tile in the traversal"
 * section), so a piece exceeding this width is rejected outright, the same
 * way a curved (non-vertical) cut is: the caller falls back to a single
 * full-mesh render. 170° (not the mathematical limit of 180°) leaves a
 * margin against floating-point noise right at the boundary.
 */
const MAX_PIECE_SPAN_DEG = 170;

/**
 * Unwrap a GeoJSON-flipped edge (RFC 7946 §5.2: west > east marks a
 * crossing) onto the continuous native scale `edgeUCut`'s seam search
 * expects, by adding 360° to `eastLng`. A no-op for an edge already in
 * native un-normalized form (west < east) or for a degenerate zero-width
 * edge (west === east).
 */
export function unwrapEastLng(westLng: number, eastLng: number): number {
  return eastLng < westLng ? eastLng + 360 : eastLng;
}

/**
 * Correct one reprojected reference point's common-space x for an
 * antimeridian-crossing tile: raw x in the lower half `[0, tileSize/2)` is
 * on the wrapped side (proj4 normalized it back into range) and gets
 * `+tileSize`, continuing past the near-180 side instead of wrapping to the
 * start of the world. No-op for a point already on the near-180 side,
 * including the exact seam boundary. See `buildPieceReprojection` for the
 * full reasoning (same rule, applied there per-piece at render time).
 */
export function unwrapCommonSpaceX(x: number, tileSize: number): number {
  return x < tileSize / 2 ? x + tileSize : x;
}

/**
 * Locate where a single horizontal edge crosses the antimeridian, as a fraction
 * of the edge's eastward span (0 at the west corner, 1 at the east corner).
 *
 * Returns `undefined` if the edge does not cross. Accepts either corner
 * longitude encoding described on {@link CornerLongitudes} — a GeoJSON-flipped
 * edge is unwrapped via {@link unwrapEastLng} before the seam search, which
 * finds the smallest antimeridian line `−180 + 360k` strictly interior to
 * `(westLng, eastLng)`. Strict inequalities give the correct non-crossing
 * answer when a corner lies exactly on ±180.
 */
function edgeUCut(westLng: number, eastLng: number): number | undefined {
  const unwrappedEastLng = unwrapEastLng(westLng, eastLng);
  // Degenerate or non-monotonic edge — caller is expected to pass
  // west-then-east in the source CRS's native ordering.
  if (unwrappedEastLng <= westLng) {
    return undefined;
  }
  // Smallest antimeridian line (−180 + 360k) strictly greater than westLng.
  const k = Math.ceil((westLng + 180) / 360);
  const seam = -180 + 360 * k;
  if (seam <= westLng || seam >= unwrappedEastLng) {
    return undefined;
  }
  return (seam - westLng) / (unwrappedEastLng - westLng);
}

/**
 * Detect whether a tile crosses the antimeridian and, if so, locate the cut.
 *
 * Only **axis-aligned (vertical) crossings** are handled today (MVP): the top
 * and bottom edges must cross ±180° at the same u. We *should* eventually
 * support the general case — slanted cuts (rotated geotransforms) and curved
 * cuts (non-geographic CRSs) — but for now those return `undefined` and fall
 * back to a single full-mesh layer. See issue #575.
 *
 * Also rejects a cut where either resulting piece would be ≥
 * {@link MAX_PIECE_SPAN_DEG} wide — see that constant's doc comment — falling
 * back to a single full-mesh layer the same way an unsupported slanted or
 * curved cut does.
 *
 * Assumes u increases eastward (standard north-up geotransform). Corner
 * longitudes may be in either encoding described on {@link CornerLongitudes}.
 */
export function antimeridianCut(
  cornerLngs: CornerLongitudes,
): AntimeridianCut | undefined {
  const { topLeft, topRight, bottomLeft, bottomRight } = cornerLngs;

  const topUCut = edgeUCut(topLeft, topRight);
  const bottomUCut = edgeUCut(bottomLeft, bottomRight);
  if (topUCut === undefined || bottomUCut === undefined) {
    return undefined;
  }
  // Vertical only for now: both edges must cross at the same u. A slanted cut
  // (top and bottom crossing at different u) is a valid antimeridian crossing
  // we don't yet handle — see the function docstring and issue #575.
  if (Math.abs(topUCut - bottomUCut) > U_EPSILON) {
    return undefined;
  }
  const uCut = (topUCut + bottomUCut) / 2;

  // Reject a piece too wide for unwrapCommonSpaceX's halfway-point
  // assumption to hold — see MAX_PIECE_SPAN_DEG's doc comment.
  const totalSpanDeg = unwrapEastLng(topLeft, topRight) - topLeft;
  const westPieceSpanDeg = uCut * totalSpanDeg;
  const eastPieceSpanDeg = totalSpanDeg - westPieceSpanDeg;
  if (
    westPieceSpanDeg >= MAX_PIECE_SPAN_DEG ||
    eastPieceSpanDeg >= MAX_PIECE_SPAN_DEG
  ) {
    return undefined;
  }

  return { uCut };
}
