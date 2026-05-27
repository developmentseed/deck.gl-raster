import type { InitialTriangulation } from "@developmentseed/raster-reproject";
import { rectangleSeed } from "@developmentseed/raster-reproject";

/** Maximum latitude representable in Web Mercator (EPSG:3857), in degrees. */
const MAX_WEB_MERCATOR_LAT = 85.05112877980659;

/** Tolerance for the north-up check and degenerate-band guard, in degrees. */
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
 * Only **north-up geographic** tiles are handled — where latitude is constant
 * across each row, so the valid band is an axis-aligned rectangle. Rotated or
 * projected tiles return `undefined` (the caller falls back to the full mesh).
 *
 * @param cornerLats WGS84 latitudes of the tile's four corners.
 * @param maxLat     Web Mercator latitude limit. Defaults to ±85.051°.
 */
export function webMercatorInitialTriangulation(
  cornerLats: CornerLatitudes,
  maxLat: number = MAX_WEB_MERCATOR_LAT,
): InitialTriangulation | undefined {
  const { topLeft, topRight, bottomLeft, bottomRight } = cornerLats;

  // North-up means latitude is constant across each row, so the clamp band is
  // an axis-aligned rectangle. Otherwise fall back to the full mesh.
  const northUp =
    Math.abs(topLeft - topRight) < LAT_EPSILON &&
    Math.abs(bottomLeft - bottomRight) < LAT_EPSILON;
  if (!northUp) {
    return undefined;
  }

  const north = topLeft;
  const south = bottomLeft;
  // Degenerate or south-up tile: leave it to the default full mesh.
  if (north - south <= LAT_EPSILON) {
    return undefined;
  }

  // Nothing to clamp if the whole tile is already within bounds.
  if (north <= maxLat && south >= -maxLat) {
    return undefined;
  }

  // v runs 0 (north) → 1 (south); lat(v) = north - v * (north - south).
  const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
  const vTop = clamp01((north - maxLat) / (north - south));
  const vBottom = clamp01((north - -maxLat) / (north - south));

  // Fully-polar tile (entirely outside ±maxLat): empty band, nothing to render.
  // Such tiles are normally excluded by the dataset-bounds clamp; guard anyway
  // so we never emit a degenerate seed.
  if (vBottom - vTop < LAT_EPSILON) {
    return undefined;
  }

  return rectangleSeed(0, vTop, 1, vBottom);
}
