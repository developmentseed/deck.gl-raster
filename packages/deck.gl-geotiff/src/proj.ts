import type { PROJJSONDefinition } from "proj4/dist/lib/core";

export type GeoKeysParser = (
  geoKeys: Record<string, any>,
) => Promise<PROJJSONDefinition | null>;

/**
 * Get the Projection of a GeoTIFF
 *
 * The first `image` must be passed in, as only the top-level IFD contains geo
 * keys.
 */
export async function epsgIoGeoKeyParser(
  geoKeys: Record<string, any>,
): Promise<PROJJSONDefinition | null> {
  const projectionCode: number | null =
    geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || null;

  const sourceProjection = await getProjjson(projectionCode);
  return sourceProjection;
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
