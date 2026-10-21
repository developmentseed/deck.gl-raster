import { BUILTIN_PROJJSON } from "./builtin-projjson.js";
import type { ProjectionDefinition } from "./parse-wkt.js";
import { parseWkt } from "./parse-wkt.js";
import type { ProjJson } from "./projjson.js";

/**
 * A global registry holding parsed projection definitions.
 */
export const PROJECTION_REGISTRY = new Map<string, ProjectionDefinition>();

/**
 * Resolutions in flight, by EPSG code, so that layers resolving the same code
 * at the same time (every source of a mosaic, every band of a MultiCOGLayer)
 * share one request. An entry is removed once it settles, so a failed request
 * is retried by the next caller.
 */
const IN_FLIGHT = new Map<number, Promise<ProjectionDefinition>>();

export type EpsgResolver = (epsg: number) => Promise<ProjectionDefinition>;

/**
 * Resolve an EPSG code to a projection definition.
 *
 * Codes that proj4 ships definitions for (4326, 3857, 4269) come from a
 * built-in table; others are fetched from epsg.io once and cached in
 * {@link PROJECTION_REGISTRY}.
 */
export async function epsgResolver(epsg: number) {
  const key = `EPSG:${epsg}`;
  const cachedProj = PROJECTION_REGISTRY.get(key);
  if (cachedProj !== undefined) {
    return cachedProj;
  }

  const builtin = BUILTIN_PROJJSON.get(epsg);
  if (builtin !== undefined) {
    const proj = parseWkt(builtin);
    PROJECTION_REGISTRY.set(key, proj);
    return proj;
  }

  let pending = IN_FLIGHT.get(epsg);
  if (pending === undefined) {
    pending = getProjjson(epsg)
      .then((projjson) => {
        const proj = parseWkt(projjson);
        PROJECTION_REGISTRY.set(key, proj);
        return proj;
      })
      .finally(() => {
        IN_FLIGHT.delete(epsg);
      });
    IN_FLIGHT.set(epsg, pending);
  }
  return pending;
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
