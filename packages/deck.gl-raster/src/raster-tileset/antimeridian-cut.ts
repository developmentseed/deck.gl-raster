/** WGS84 longitudes (normalized to (−180, 180]) of a tile's four corners. */
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
 * Returns `undefined` if the edge does not cross: with u increasing eastward, a
 * non-crossing edge has west lng < east lng, while a crossing edge wraps, so
 * `eastLng < westLng`.
 */
function edgeUCut(westLng: number, eastLng: number): number | undefined {
  // Not crossing if the eastward span doesn't wrap.
  if (eastLng >= westLng) {
    return undefined;
  }
  // Eastward distance west→(+180) then (−180)→east.
  const toSeam = 180 - westLng;
  const fromSeam = eastLng + 180;
  const total = toSeam + fromSeam;
  if (total <= 0) {
    return undefined;
  }
  return toSeam / total;
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
 * Assumes u increases eastward (standard north-up geotransform). A non-crossing
 * tile has west-edge lng < east-edge lng; a crossing tile wraps, so
 * `eastLng < westLng`.
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
