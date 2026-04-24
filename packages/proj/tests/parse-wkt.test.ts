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
});
