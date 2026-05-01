import proj4 from "proj4";

/**
 * Hard-code Vermont CRS definitions so the example doesn't pull a full
 * EPSG resolver. Covers the Vermont COGs in the curated file table.
 *
 * Definitions copied from epsg.io:
 * - https://epsg.io/32145.proj4 (NAD83 / Vermont State Plane)
 * - https://epsg.io/26918.proj4 (NAD83 / UTM Zone 18N)
 */
const PROJ_DEFS: Record<string, string> = {
  "EPSG:32145":
    "+proj=tmerc +lat_0=42.5 +lon_0=-72.5 +k=0.999964286 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  "EPSG:26918":
    "+proj=utm +zone=18 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
};

for (const [code, def] of Object.entries(PROJ_DEFS)) {
  proj4.defs(code, def);
}

/**
 * Resolve a numeric EPSG code to a proj4 definition string.
 *
 * Used by `COGLayer` to reproject tiles into Web Mercator. Throws if the
 * code is not in the static table.
 */
export async function epsgResolver(epsg: number): Promise<string> {
  const code = `EPSG:${epsg}`;
  const def = proj4.defs(code);
  if (!def) {
    throw new Error(
      `EPSG code ${code} not in static proj4 definitions for vermont-cog-comparison example`,
    );
  }
  return def;
}
