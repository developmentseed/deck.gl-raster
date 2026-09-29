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
  /**
   * Total angular width of the tile (both pieces combined, in degrees) —
   * `unwrapEastLng(topLeft, topRight) - topLeft` from the edge used to
   * locate the cut. Used by {@link unwrapCommonSpaceX} to convert a point's
   * `u` distance from the seam into degrees, and by {@link antimeridianCut}
   * itself to reject a self-overlapping (≥360°) tile.
   */
  totalSpanDeg: number;
}

/**
 * Tolerance for treating the top- and bottom-edge crossings as the same u
 * (i.e. the cut is vertical). Crossings further apart than this are rejected as
 * slanted.
 */
const U_EPSILON = 1e-6;

/**
 * Maximum total angular width (degrees, both pieces combined) a tile may
 * have and still be cut.
 *
 * This is not an accuracy limit on {@link unwrapCommonSpaceX} — its per-point
 * correction is derived from each point's own distance from the seam (in
 * already-validated corner longitudes), not a magnitude test against a fixed
 * midpoint, so it has no per-piece width limit (see
 * `replace-256-x-heuristic.md`). The one limit that remains is physical, not
 * a property of this code: a tile ≥360° wide has two pixel columns claiming
 * the same real-world longitude — self-overlapping, invalid data with no
 * correct rendering, cut or not. 359.9° (not the exact boundary of 360°)
 * leaves a margin against floating-point noise.
 */
const MAX_TOTAL_SPAN_DEG = 359.9;

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
 * antimeridian-crossing tile, given the point's own fractional position `u`
 * (0..1) along the tile's pixel/UV domain — the same domain `cut.uCut` is
 * defined in.
 *
 * Rather than testing the already-wrapped `x` against a fixed midpoint
 * (`tileSize/2`) — which can't tell "this point wrapped around the seam"
 * apart from "this point is just far from the seam" once the tile is wide —
 * this computes an *expected* `x` directly from the point's own signed
 * distance from the seam (`(u - cut.uCut) * cut.totalSpanDeg`, in degrees,
 * using the already-validated corner longitudes `antimeridianCut` located
 * the seam from) and snaps `x` to the representative nearest that
 * expectation. The seam itself (`u = cut.uCut`) always maps to exactly
 * `tileSize`; the west side (`u < cut.uCut`) extends below it, the east side
 * (`u > cut.uCut`) extends above it. See `replace-256-x-heuristic.md` for
 * the full derivation and why this has no per-piece width limit.
 *
 * This is the "combined" form used directly by the traversal's bounding
 * volume, which wants one contiguous box spanning both pieces around the
 * seam (west below `tileSize`, east above it). `buildPieceReprojection`'s
 * east-piece branch re-anchors the result into its own local frame (seam at
 * `0`, not `tileSize`) by subtracting `tileSize` — see that method's doc
 * comment.
 */
export function unwrapCommonSpaceX(
  x: number,
  u: number,
  cut: AntimeridianCut,
  tileSize: number,
): number {
  const signedDegreesFromSeam = (u - cut.uCut) * cut.totalSpanDeg;
  const expectedX = tileSize + signedDegreesFromSeam * (tileSize / 360);
  return x + Math.round((expectedX - x) / tileSize) * tileSize;
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
 * Also rejects a tile whose total width would be ≥ {@link MAX_TOTAL_SPAN_DEG}
 * — see that constant's doc comment — falling back to a single full-mesh
 * layer the same way an unsupported slanted or curved cut does.
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

  // Reject a self-overlapping tile — see MAX_TOTAL_SPAN_DEG's doc comment.
  const totalSpanDeg = unwrapEastLng(topLeft, topRight) - topLeft;
  if (totalSpanDeg >= MAX_TOTAL_SPAN_DEG) {
    return undefined;
  }

  return { uCut, totalSpanDeg };
}
