/**
 * WGS84 longitudes of a tile's four corners, as returned by
 * `descriptor.projectTo4326(corner)[0]` — i.e. native and **not** normalized to
 * (−180, 180]. For a north-up geotransform the west edge's lng is strictly
 * less than the east edge's lng (proj4 4326→4326 is identity and does not
 * wrap), so a tile crossing the antimeridian shows up as a span like
 * (−204, −162) rather than (156, −162).
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
 * Locate where a single horizontal edge crosses the antimeridian, as a fraction
 * of the edge's eastward span (0 at the west corner, 1 at the east corner).
 *
 * Returns `undefined` if the edge does not cross. Works on native un-normalized
 * longitudes (e.g. `westLng = −204`, `eastLng = −162`) by searching for the
 * smallest antimeridian line `−180 + 360k` strictly interior to `(westLng,
 * eastLng)`. Strict inequalities give the correct non-crossing answer when a
 * corner lies exactly on ±180.
 */
function edgeUCut(westLng: number, eastLng: number): number | undefined {
  // Degenerate or non-monotonic edge — caller is expected to pass
  // west-then-east in the source CRS's native ordering.
  if (eastLng <= westLng) {
    return undefined;
  }
  // Smallest antimeridian line (−180 + 360k) strictly greater than westLng.
  const k = Math.ceil((westLng + 180) / 360);
  const seam = -180 + 360 * k;
  if (seam <= westLng || seam >= eastLng) {
    return undefined;
  }
  return (seam - westLng) / (eastLng - westLng);
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
 * Assumes u increases eastward (standard north-up geotransform) and that
 * corner longitudes are passed in native, un-normalized form — that is what
 * `descriptor.projectTo4326` returns for an EPSG:4326 source whose
 * `ModelTiepoint` sits past ±180° (e.g. `−204°`).
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
  return { uCut: (topUCut + bottomUCut) / 2 };
}
