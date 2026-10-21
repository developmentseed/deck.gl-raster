import proj4 from "proj4";
import type { ProjectionDefinition } from "./parse-wkt.js";
import { parseWkt } from "./parse-wkt.js";
import type { ProjJson } from "./projjson.js";

/**
 * Projection definitions stored by EPSG code.
 *
 * We store promises so that callers resolving the same code at the same time
 * share one request. {@link epsgResolver} fills the registry as needed, or the
 * user can register projections manually with {@link registerProjection}.
 */
export const PROJECTION_REGISTRY = new Map<
  string,
  Promise<ProjectionDefinition>
>();

export type EpsgResolver = (epsg: number) => Promise<ProjectionDefinition>;

/**
 * Manually register a projection definition for an EPSG code.
 *
 * Pre-registered definitions will never pass through {@link EpsgResolver}.
 */
export function registerProjection(
  epsg: number,
  definition: string | ProjJson,
): void {
  PROJECTION_REGISTRY.set(
    `EPSG:${epsg}`,
    Promise.resolve(parseWkt(definition)),
  );
}

/**
 * Resolve an EPSG code to a projection definition.
 *
 * Codes that proj4 ships definitions for (4326, 4269, 3857 and the UTM zones)
 * are resolved without a request; others are fetched from epsg.io once. A
 * failed request is not kept, so the next caller retries.
 */
export function epsgResolver(epsg: number): Promise<ProjectionDefinition> {
  const key = `EPSG:${epsg}`;
  let pending = PROJECTION_REGISTRY.get(key);
  if (pending === undefined) {
    pending = resolve(key, epsg).catch((error: unknown) => {
      PROJECTION_REGISTRY.delete(key);
      throw error;
    });
    PROJECTION_REGISTRY.set(key, pending);
  }
  return pending;
}

async function resolve(
  key: string,
  epsg: number,
): Promise<ProjectionDefinition> {
  if (proj4.defs(key) !== undefined) {
    // `Proj` fills in what the parsed proj string leaves out, such as the
    // ellipsoid's axes, which layers read as `a` to size degree units.
    const proj = new proj4.Proj(key);
    return { ...proj, title: proj.title ?? key } as ProjectionDefinition;
  }
  return parseWkt(await getProjjson(epsg));
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
