// Resolving a GeoTIFF's CRS, shared by COGSource and MultiCOGSource

import type { GeoTIFF } from "@developmentseed/geotiff";
import type { EpsgResolver, ProjectionDefinition } from "@developmentseed/proj";
import { parseWkt } from "@developmentseed/proj";

/**
 * Resolve a GeoTIFF's `crs`: an EPSG code through `epsgResolver`, and WKT or
 * PROJJSON with `parseWkt`.
 */
export async function resolveProjection(
  crs: GeoTIFF["crs"],
  epsgResolver: EpsgResolver,
): Promise<ProjectionDefinition> {
  return typeof crs === "number" ? await epsgResolver(crs) : parseWkt(crs);
}
