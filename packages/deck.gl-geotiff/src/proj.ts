import type { ProjectionDefinition } from "proj4";
import proj4 from "proj4";
import type { PROJJSONDefinition } from "proj4/dist/lib/core";

// Register EPSG:3857 (Web Mercator) - not included in proj4 by default
proj4.defs(
  "EPSG:3857",
  "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs",
);

export type SupportedCrsUnit =
  | "m"
  | "metre"
  | "meter"
  | "meters"
  | "foot"
  | "US survey foot"
  | "degree";

export interface ProjectionInfo {
  /** Proj4-compatible projection definition (PROJJSON or proj4 string) */
  def: string | PROJJSONDefinition;
  /** A parsed projection definition */
  parsed: ProjectionDefinition;
  /** Units of the coordinate system */
  coordinatesUnits: SupportedCrsUnit;
  /** CRS code if known (e.g., "EPSG:4326", "EPSG:3857") */
  code?: string;
}

export type GeoKeysParser = (
  geoKeys: Record<string, any>,
) => Promise<ProjectionInfo | null>;

/**
 * Get the Projection of a GeoTIFF
 *
 * The first `image` must be passed in, as only the top-level IFD contains geo
 * keys.
 */
export async function epsgIoGeoKeyParser(
  geoKeys: Record<string, any>,
): Promise<ProjectionInfo | null> {
  const projectionCode: number | null =
    geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || null;

  const sourceProjection = await getProjjson(projectionCode);

  if (!sourceProjection) {
    return null;
  }

  const parsed = parseCrs(sourceProjection);
  return {
    def: sourceProjection,
    parsed,
    coordinatesUnits: parsed.units as SupportedCrsUnit,
    code: projectionCode ? `EPSG:${projectionCode}` : undefined,
  };
}

/** Query epsg.io for the PROJJSON corresponding to the given EPSG code. */
async function getProjjson(projectionCode: number | null) {
  if (projectionCode === null) {
    return null;
  }

  const url = `https://epsg.io/${projectionCode}.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch projection data from ${url}`);
  }
  const data = await response.json();
  return data;
}

/**
 * Parse a proj4-accepted input into a ProjectionDefinition
 */
export function parseCrs(
  crs: string | PROJJSONDefinition,
): ProjectionDefinition {
  // If you pass proj4.defs a projjson, it doesn't parse it; it just returns the
  // input.
  //
  // Instead, you need to assign it to an alias and then retrieve it.

  const key = "__deck.gl-geotiff-internal__";
  proj4.defs(key, crs);
  return proj4.defs(key);
}
