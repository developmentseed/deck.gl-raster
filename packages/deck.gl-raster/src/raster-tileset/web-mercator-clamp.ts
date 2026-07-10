import type { InitialTriangulation } from "@developmentseed/raster-reproject";
import { triangulateRectangle } from "@developmentseed/raster-reproject";

/** Maximum latitude representable in Web Mercator (EPSG:3857), in degrees. */
const MAX_WEB_MERCATOR_LAT = 85.05112877980659;

/** Tolerance for the constant-latitude check and degenerate-band guard, in degrees. */
const LAT_EPSILON = 1e-6;

/**
 * The WGS84 latitudes of a tile's four corners.
 */
export interface CornerLatitudes {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

/**
 * Compute a {@link InitialTriangulation} that clamps a tile's reprojection mesh
 * to the latitude band representable in Web Mercator (±85.051°), or `undefined`
 * if no clamp is needed or possible.
 *
 * Beyond ±85.051°, `makeClampedForwardTo3857` collapses every polar vertex onto
 * the same clamped Y, so the reprojector emits degenerate near-pole triangles
 * that never converge (see #182 / #351). Seeding the reprojector with the
 * clamped band avoids meshing those rows entirely.
 *
 * Only tiles whose **rows are constant-latitude** are handled — where latitude
 * is constant across each row, so the valid band is an axis-aligned rectangle.
 *
 * This covers both north-up grids and south-up grids. Rotated or projected
 * tiles return `undefined` (the caller falls back to the full mesh).
 *
 * @param cornerLats WGS84 latitudes of the tile's four corners.
 * @param maxLat     Web Mercator latitude limit. Defaults to ±85.051°.
 */
export function createInitialWebMercatorTriangulation(
  cornerLats: CornerLatitudes,
  maxLat: number = MAX_WEB_MERCATOR_LAT,
): InitialTriangulation | undefined {
  const { topLeft, topRight, bottomLeft, bottomRight } = cornerLats;

  // Each row must be constant-latitude for the clamp band to be an axis-aligned
  // rectangle in UV space. Otherwise fall back to the full mesh.
  const rowsIsoLatitude =
    Math.abs(topLeft - topRight) < LAT_EPSILON &&
    Math.abs(bottomLeft - bottomRight) < LAT_EPSILON;
  if (!rowsIsoLatitude) {
    return undefined;
  }

  // v runs 0 (top row) → 1 (bottom row); latitude varies linearly along it:
  //   lat(v) = top + v * (bottom - top)
  // Do NOT assume top is the northern edge: a positive-`e` (south-up) affine
  // puts the south pole at row 0, so `top` is the southern edge. Deriving the
  // band from the actual top/bottom keeps this orientation-agnostic.
  const top = topLeft;
  const bottom = bottomLeft;

  // Degenerate tile (zero latitude span): leave it to the default full mesh.
  if (Math.abs(bottom - top) <= LAT_EPSILON) {
    return undefined;
  }

  // Nothing to clamp if the whole tile is already within bounds (linear interp
  // between two in-band corners stays in band).
  if (
    top <= maxLat &&
    top >= -maxLat &&
    bottom <= maxLat &&
    bottom >= -maxLat
  ) {
    return undefined;
  }

  // Intersect the tile's latitude segment with the band [-maxLat, maxLat]:
  // solve lat(v) = ±maxLat for v, then take the overlapping v-interval. min/max
  // makes this independent of whether latitude increases or decreases with v.
  const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
  const vAtMaxLat = (maxLat - top) / (bottom - top);
  const vAtMinLat = (-maxLat - top) / (bottom - top);
  const vTop = clamp01(Math.min(vAtMaxLat, vAtMinLat));
  const vBottom = clamp01(Math.max(vAtMaxLat, vAtMinLat));

  // Fully-polar tile (entirely outside ±maxLat): empty band, nothing to render.
  // Such tiles are normally excluded by the dataset-bounds clamp; guard anyway
  // so we never emit a degenerate seed.
  if (vBottom - vTop < LAT_EPSILON) {
    return undefined;
  }

  return triangulateRectangle(0, vTop, 1, vBottom);
}
