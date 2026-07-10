import type { ProjectionFunction } from "./transform-bounds.js";

const WGS84_ELLIPSOID_A = 6378137;

// Maximum latitude representable in Web Mercator (EPSG:3857), in degrees.
// Beyond this, the Mercator projection is undefined.
const MAX_WEB_MERCATOR_LAT = 85.05112877980659;

/**
 * Convert a WGS84 longitude/latitude to EPSG:3857 meters analytically.
 * Valid for latitudes in [-MAX_WEB_MERCATOR_LAT, MAX_WEB_MERCATOR_LAT].
 */
function wgs84To3857(lon: number, lat: number): [number, number] {
  const x = (lon * Math.PI * WGS84_ELLIPSOID_A) / 180;
  const latRad = (lat * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + latRad / 2)) * WGS84_ELLIPSOID_A;
  return [x, y];
}

/**
 * Wrap a proj4 forward projection to EPSG:3857 so that it never returns NaN.
 *
 * proj4 returns [NaN, NaN] for points at the poles (lat = ±90°) because the
 * Mercator projection is undefined there. The wrapper falls back to:
 *   1. Project the input to WGS84 via `forwardTo4326`
 *   2. Clamp the latitude to the Web Mercator limit (±85.05°)
 *   3. Convert analytically from WGS84 to EPSG:3857
 *
 * This correctly handles any input CRS, not just EPSG:4326.
 *
 * NOTE: An identical copy of this function lives in `raster-tile-traversal.ts`.
 * The two packages cannot share code due to their dependency relationship
 * (deck.gl-geotiff depends on deck.gl-raster, not vice versa). If this logic
 * changes, update both copies.
 *
 * Perhaps in the future we'll make a `@developmentseed/projections` package to
 * hold shared projection utilities like this. *
 */
export function makeClampedForwardTo3857(
  forwardTo3857: ProjectionFunction,
  forwardTo4326: ProjectionFunction,
): ProjectionFunction {
  return (x: number, y: number): [number, number] => {
    const [px, py] = forwardTo3857(x, y);
    if (Number.isFinite(px) && Number.isFinite(py)) {
      return [px, py];
    }
    const [lon, lat] = forwardTo4326(x, y);
    const clampedLat = Math.max(
      -MAX_WEB_MERCATOR_LAT,
      Math.min(MAX_WEB_MERCATOR_LAT, lat),
    );
    return wgs84To3857(lon, clampedLat);
  };
}
