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

const U_EPSILON = 1e-6;

/**
 * Detect whether a tile crosses the antimeridian and, if so, locate the cut.
 *
 * Only **axis-aligned (vertical) crossings** are handled (MVP): the top and
 * bottom edges must cross ±180° at the same u. Returns `undefined` for
 * non-crossing tiles and for non-vertical (slanted/curved) crossings, which
 * fall back to a single full-mesh layer.
 *
 * Assumes u increases eastward (standard north-up geotransform). A non-crossing
 * tile has west-edge lng < east-edge lng; a crossing tile wraps, so
 * `eastLng < westLng`.
 */
export function antimeridianCut(
  cornerLngs: CornerLongitudes,
): AntimeridianCut | undefined {
  const { topLeft, topRight, bottomLeft, bottomRight } = cornerLngs;

  const edgeUCut = (westLng: number, eastLng: number): number | undefined => {
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
  };

  const topUCut = edgeUCut(topLeft, topRight);
  const bottomUCut = edgeUCut(bottomLeft, bottomRight);
  if (topUCut === undefined || bottomUCut === undefined) {
    return undefined;
  }
  // Vertical only: both edges must cross at the same u.
  if (Math.abs(topUCut - bottomUCut) > U_EPSILON) {
    return undefined;
  }
  return { uCut: (topUCut + bottomUCut) / 2 };
}
