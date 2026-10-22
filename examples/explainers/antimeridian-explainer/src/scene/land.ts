import { PERIOD } from "./constants.js";

/** Natural Earth's 1:50m land polygons (public domain). */
export const LAND_FILE = "ne_50m_land.geojson";

/** Where the land is read from: Natural Earth on GitHub, at a release tag. */
export const LAND_URL = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/${LAND_FILE}`;

/** How long the land may take to load before the explainer goes on without it, in ms. */
const LAND_TIMEOUT_MS = 20_000;

/** The latitude past which Web Mercator can't go. */
const MAX_LATITUDE = 85.0511287798066;

/** One land polygon in common space, with the x extent of its outer ring. */
export type LandPolygon = {
  /** Outer ring, then holes, as `[x, y]` in common space. */
  rings: [number, number][][];
  minX: number;
  maxX: number;
};

/** The parts of a GeoJSON land layer the explainer reads. */
type LandGeoJson = {
  features: { geometry: { type: string; coordinates: unknown } }[];
};

/** A longitude and latitude in Web Mercator common space (one world 0-512 wide). */
export function lngLatToCommon(lng: number, lat: number): [number, number] {
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const phi = (clamped * Math.PI) / 180;
  return [
    ((lng + 180) / 360) * PERIOD,
    PERIOD / 2 +
      (PERIOD / (2 * Math.PI)) * Math.log(Math.tan(Math.PI / 4 + phi / 2)),
  ];
}

/**
 * A GeoJSON land layer's polygons in common space. Natural Earth splits land
 * at ±180°, so no polygon crosses the antimeridian.
 */
export function landToCommon(geojson: LandGeoJson): LandPolygon[] {
  const polygons: LandPolygon[] = [];
  for (const { geometry } of geojson.features) {
    const parts =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? (geometry.coordinates as unknown[])
          : [];
    for (const part of parts as [number, number][][][]) {
      const rings = part.map((ring) =>
        ring.map(([lng, lat]) => lngLatToCommon(lng, lat)),
      );
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      for (const [x] of rings[0] ?? []) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      polygons.push({ rings, minX, maxX });
    }
  }
  return polygons;
}

/**
 * The land a view from x `minX` to `maxX` shows, in whichever copy of the
 * world it falls: each polygon's rings, moved by whole worlds.
 */
export function landInRange(
  land: LandPolygon[],
  [minX, maxX]: [number, number],
): [number, number][][][] {
  const shown: [number, number][][][] = [];
  for (const dx of [-PERIOD, 0, PERIOD]) {
    for (const polygon of land) {
      if (polygon.maxX + dx < minX || polygon.minX + dx > maxX) {
        continue;
      }
      shown.push(
        dx === 0
          ? polygon.rings
          : polygon.rings.map((ring) =>
              ring.map(([x, y]): [number, number] => [x + dx, y]),
            ),
      );
    }
  }
  return shown;
}

/** Read the land, naming the file if it can't be read or takes too long. */
export async function loadLand(
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<LandPolygon[]> {
  const fetchLand = options.fetch ?? fetch;
  const signal = options.signal ?? AbortSignal.timeout(LAND_TIMEOUT_MS);
  try {
    const response = await fetchLand(LAND_URL, { signal });
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    return landToCommon((await response.json()) as LandGeoJson);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw Object.assign(new Error(`Couldn't load ${LAND_FILE}: ${message}`), {
      cause,
    });
  }
}
