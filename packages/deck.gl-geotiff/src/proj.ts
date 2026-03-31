import type { ProjJson } from "@developmentseed/geotiff";
import type { ProjectionDefinition } from "wkt-parser";
import wktParser from "wkt-parser";

const WGS84_ELLIPSOID_A = 6378137;

// Maximum latitude representable in Web Mercator (EPSG:3857), in degrees.
// Beyond this, the Mercator projection is undefined.
const MAX_WEB_MERCATOR_LAT = 85.05112877980659;

const WEB_MERCATOR_METER_CIRCUMFERENCE = 2 * Math.PI * WGS84_ELLIPSOID_A;
const HALF_CIRCUMFERENCE = WEB_MERCATOR_METER_CIRCUMFERENCE / 2;

type ProjectionFn = (x: number, y: number) => [number, number];

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
 * If a tile's EPSG:3857 corner x-values span more than half the globe, wrap
 * `forwardTo3857` / `inverseFrom3857` so the coordinate space is continuous.
 *
 * Returns the original functions unchanged when no wrapping is needed.
 */
export function wrapAntimeridianProjections(
  cornerXs3857: number[],
  forwardTo3857: ProjectionFn,
  inverseFrom3857: ProjectionFn,
): { forwardTo3857: ProjectionFn; inverseFrom3857: ProjectionFn } {
  const xMin = Math.min(...cornerXs3857);
  const xMax = Math.max(...cornerXs3857);

  if (xMax - xMin <= HALF_CIRCUMFERENCE) {
    return { forwardTo3857, inverseFrom3857 };
  }

  return {
    forwardTo3857: (x: number, y: number): [number, number] => {
      const [px, py] = forwardTo3857(x, y);
      return [px < 0 ? px + WEB_MERCATOR_METER_CIRCUMFERENCE : px, py];
    },
    inverseFrom3857: (x: number, y: number): [number, number] => {
      const unwrapped =
        x > HALF_CIRCUMFERENCE ? x - WEB_MERCATOR_METER_CIRCUMFERENCE : x;
      return inverseFrom3857(unwrapped, y);
    },
  };
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
  forwardTo3857: (x: number, y: number) => [number, number],
  forwardTo4326: (x: number, y: number) => [number, number],
): (x: number, y: number) => [number, number] {
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

/**
 * A global registry holding parsed projection definitions.
 */
const PROJECTION_REGISTRY = new Map<string, ProjectionDefinition>();

export type EpsgResolver = (epsg: number) => Promise<ProjectionDefinition>;

export async function epsgResolver(epsg: number) {
  const key = `EPSG:${epsg}`;
  // TODO: override global proj4 EPSG:4326 definition because it doesn't include
  // semi major axis
  const cachedProj = PROJECTION_REGISTRY.get(key);
  if (cachedProj !== undefined) {
    return cachedProj;
  }

  const projjson = await getProjjson(epsg);
  const proj = wktParser(projjson);
  PROJECTION_REGISTRY.set(key, proj);

  return proj;
}

/** Query epsg.io for the PROJJSON corresponding to the given EPSG code. */
async function getProjjson(epsg: number): Promise<ProjJson> {
  const url = `https://epsg.io/${epsg}.json`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch PROJJSON from ${url}`);
  }

  return await resp.json();
}
