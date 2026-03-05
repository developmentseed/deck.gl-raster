import type { ProjJson } from "@developmentseed/geotiff";
import type { ProjectionDefinition } from "wkt-parser";
import wktParser from "wkt-parser";

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
