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
  "EPSG:32145": `PROJCRS["NAD83 / Vermont",BASEGEOGCRS["NAD83",DATUM["North American Datum 1983",ELLIPSOID["GRS 1980",6378137,298.257222101,LENGTHUNIT["metre",1]]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],ID["EPSG",4269]],CONVERSION["SPCS83 Vermont zone (meter)",METHOD["Transverse Mercator",ID["EPSG",9807]],PARAMETER["Latitude of natural origin",42.5,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8801]],PARAMETER["Longitude of natural origin",-72.5,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8802]],PARAMETER["Scale factor at natural origin",0.999964286,SCALEUNIT["unity",1],ID["EPSG",8805]],PARAMETER["False easting",500000,LENGTHUNIT["metre",1],ID["EPSG",8806]],PARAMETER["False northing",0,LENGTHUNIT["metre",1],ID["EPSG",8807]]],CS[Cartesian,2],AXIS["easting (X)",east,ORDER[1],LENGTHUNIT["metre",1]],AXIS["northing (Y)",north,ORDER[2],LENGTHUNIT["metre",1]],USAGE[SCOPE["Engineering survey, topographic mapping."],AREA["United States (USA) - Vermont - counties of Addison; Bennington; Caledonia; Chittenden; Essex; Franklin; Grand Isle; Lamoille; Orange; Orleans; Rutland; Washington; Windham; Windsor."],BBOX[42.72,-73.44,45.03,-71.5]],ID["EPSG",32145]]`,
  "EPSG:26918": `PROJCRS["NAD83 / UTM zone 18N",BASEGEOGCRS["NAD83",DATUM["North American Datum 1983",ELLIPSOID["GRS 1980",6378137,298.257222101,LENGTHUNIT["metre",1]]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],ID["EPSG",4269]],CONVERSION["UTM zone 18N",METHOD["Transverse Mercator",ID["EPSG",9807]],PARAMETER["Latitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8801]],PARAMETER["Longitude of natural origin",-75,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8802]],PARAMETER["Scale factor at natural origin",0.9996,SCALEUNIT["unity",1],ID["EPSG",8805]],PARAMETER["False easting",500000,LENGTHUNIT["metre",1],ID["EPSG",8806]],PARAMETER["False northing",0,LENGTHUNIT["metre",1],ID["EPSG",8807]]],CS[Cartesian,2],AXIS["(E)",east,ORDER[1],LENGTHUNIT["metre",1]],AXIS["(N)",north,ORDER[2],LENGTHUNIT["metre",1]],USAGE[SCOPE["Engineering survey, topographic mapping."],AREA["North America - between 78°W and 72°W - onshore and offshore. Canada - Nunavut; Ontario; Quebec. United States (USA) - Connecticut; Delaware; Maryland; Massachusetts; New Hampshire; New Jersey; New York; North Carolina; Pennsylvania; Virginia; Vermont."],BBOX[28.28,-78,84,-72]],ID["EPSG",26918]]`,
  "EPSG:6589": `PROJCRS["NAD83(2011) / Vermont",BASEGEOGCRS["NAD83(2011)",DATUM["NAD83 (National Spatial Reference System 2011)",ELLIPSOID["GRS 1980",6378137,298.257222101,LENGTHUNIT["metre",1]],ANCHOREPOCH[2010]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],ID["EPSG",6318]],CONVERSION["SPCS83 Vermont zone (meter)",METHOD["Transverse Mercator",ID["EPSG",9807]],PARAMETER["Latitude of natural origin",42.5,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8801]],PARAMETER["Longitude of natural origin",-72.5,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8802]],PARAMETER["Scale factor at natural origin",0.999964286,SCALEUNIT["unity",1],ID["EPSG",8805]],PARAMETER["False easting",500000,LENGTHUNIT["metre",1],ID["EPSG",8806]],PARAMETER["False northing",0,LENGTHUNIT["metre",1],ID["EPSG",8807]]],CS[Cartesian,2],AXIS["easting (X)",east,ORDER[1],LENGTHUNIT["metre",1]],AXIS["northing (Y)",north,ORDER[2],LENGTHUNIT["metre",1]],USAGE[SCOPE["Engineering survey, topographic mapping."],AREA["United States (USA) - Vermont - counties of Addison; Bennington; Caledonia; Chittenden; Essex; Franklin; Grand Isle; Lamoille; Orange; Orleans; Rutland; Washington; Windham; Windsor."],BBOX[42.72,-73.44,45.03,-71.5]],ID["EPSG",6589]]`,
};

for (const [code, def] of Object.entries(PROJ_DEFS)) {
  proj4.defs(code, def);
}

/**
 * Resolve a numeric EPSG code to a parsed proj4 definition.
 *
 * Used by `COGLayer` to reproject tiles into Web Mercator. Throws if the
 * code is not in the static table. Return type is inferred from
 * `proj4.defs`, which returns a `ProjectionDefinition`-compatible object
 * after the corresponding `proj4.defs(code, def)` registration above.
 */
export async function epsgResolver(epsg: number) {
  const code = `EPSG:${epsg}`;
  const def = proj4.defs(code);
  if (!def) {
    throw new Error(
      `EPSG code ${code} not in static proj4 definitions for vermont-cog-comparison example`,
    );
  }
  return def;
}
