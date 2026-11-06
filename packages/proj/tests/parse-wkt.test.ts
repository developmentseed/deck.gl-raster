import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import type { ProjJson } from "../../proj/src/index.js";
import { parseWkt } from "../../proj/src/index.js";

describe("parseWkt", () => {
  it("produces degree units for EPSG:4326 PROJJSON (from epsg.io)", () => {
    // Simplified response body from https://epsg.io/4326.json. Units are
    // declared per-axis on coordinate_system.axis[].unit, not at the top level.
    // When wkt-parser fails to resolve that, parseWkt normalizes longlat to
    // degree.
    const projjson: ProjJson = {
      $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
      type: "GeographicCRS",
      name: "WGS 84",
      datum_ensemble: {
        name: "World Geodetic System 1984 ensemble",
        members: [],
        ellipsoid: {
          name: "WGS 84",
          semi_major_axis: 6378137,
          inverse_flattening: 298.257223563,
        },
      },
      coordinate_system: {
        subtype: "ellipsoidal",
        axis: [
          {
            name: "Geodetic latitude",
            abbreviation: "Lat",
            direction: "north",
            unit: "degree",
          },
          {
            name: "Geodetic longitude",
            abbreviation: "Lon",
            direction: "east",
            unit: "degree",
          },
        ],
      },
    };

    const def = parseWkt(projjson);

    expect(def.projName).toBe("longlat");
    expect(def.units).toBe("degree");
    expect(def.a).toBe(6378137);
  });

  it("normalizes longlat with units 'unknown' to degree", () => {
    // GEOGCS WKT without a UNIT directive can cause wkt-parser to emit
    // units: "unknown" or undefined. This verifies the fallback.
    const wkt =
      'GEOGCS["WGS 84",' +
      'DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],' +
      'PRIMEM["Greenwich",0],' +
      'AXIS["Latitude",NORTH],AXIS["Longitude",EAST]]';

    const def = parseWkt(wkt);

    expect(def.projName).toBe("longlat");
    expect(def.units).toBe("degree");
  });

  it("projects Lambert Cylindrical Equal Area PROJJSON like PROJ", () => {
    // Simplified response body from https://epsg.io/6933.json.
    // @developmentseed/geotiff builds the same conversion from the GeoKeys of
    // user-defined Cylindrical Equal Area CRSes.
    const projjson: ProjJson = {
      $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
      type: "ProjectedCRS",
      name: "WGS 84 / NSIDC EASE-Grid 2.0 Global",
      base_crs: {
        type: "GeographicCRS",
        name: "WGS 84",
        datum_ensemble: {
          name: "World Geodetic System 1984 ensemble",
          members: [],
          ellipsoid: {
            name: "WGS 84",
            semi_major_axis: 6378137,
            inverse_flattening: 298.257223563,
          },
        },
        coordinate_system: {
          subtype: "ellipsoidal",
          axis: [
            {
              name: "Geodetic latitude",
              abbreviation: "Lat",
              direction: "north",
              unit: "degree",
            },
            {
              name: "Geodetic longitude",
              abbreviation: "Lon",
              direction: "east",
              unit: "degree",
            },
          ],
        },
      },
      conversion: {
        name: "US NSIDC EASE-Grid 2.0 Global",
        method: { name: "Lambert Cylindrical Equal Area" },
        parameters: [
          {
            name: "Latitude of 1st standard parallel",
            value: 30,
            unit: "degree",
          },
          { name: "Longitude of natural origin", value: 0, unit: "degree" },
          { name: "False easting", value: 0, unit: "metre" },
          { name: "False northing", value: 0, unit: "metre" },
        ],
      },
      coordinate_system: {
        subtype: "Cartesian",
        axis: [
          {
            name: "Easting",
            abbreviation: "X",
            direction: "east",
            unit: "metre",
          },
          {
            name: "Northing",
            abbreviation: "Y",
            direction: "north",
            unit: "metre",
          },
        ],
      },
    };

    // @ts-expect-error proj4 typings don't cover wkt-parser output
    const [x, y] = proj4("EPSG:4326", parseWkt(projjson)).forward([10, 45]);

    // From `cs2cs +proj=longlat +datum=WGS84 +to EPSG:6933`.
    expect(x).toBeCloseTo(964862.8025, 3);
    expect(y).toBeCloseTo(5180102.3288, 3);
  });

  it("projects Cylindrical_Equal_Area WKT1 like PROJ", () => {
    // ESRI:54034 as an `ESRI PE String` GeoTIFF citation carries it.
    const wkt =
      'PROJCS["World_Cylindrical_Equal_Area",' +
      'GEOGCS["GCS_WGS_1984",' +
      'DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
      'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],' +
      'PROJECTION["Cylindrical_Equal_Area"],' +
      'PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],' +
      'PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],' +
      'UNIT["Meter",1.0]]';

    // The center of the ESRI:54034 COG in
    // https://github.com/developmentseed/deck.gl-raster/issues/649
    // @ts-expect-error proj4 typings don't cover wkt-parser output
    const [lon, lat] = proj4(parseWkt(wkt), "EPSG:4326").forward([
      -8279550, 648450,
    ]);

    // From `cs2cs ESRI:54034 +to +proj=longlat +datum=WGS84`.
    expect(lon).toBeCloseTo(-74.3764631, 6);
    expect(lat).toBeCloseTo(5.8743961, 6);
  });
});
