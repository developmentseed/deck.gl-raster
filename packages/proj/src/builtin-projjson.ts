import type { ProjJson } from "./projjson.js";

/**
 * PROJJSON for the EPSG codes that proj4 itself ships definitions for, so the
 * default resolver never has to ask epsg.io for them. Taken from
 *  on 2026-10-21 (EPSG Geodetic Parameter Dataset,
 * used under its terms of use, like ).
 */
export const BUILTIN_PROJJSON: ReadonlyMap<number, ProjJson> = new Map<
  number,
  ProjJson
>([
  [
    4326,
    {
      $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
      type: "GeographicCRS",
      name: "WGS 84",
      datum_ensemble: {
        name: "World Geodetic System 1984 ensemble",
        members: [
          {
            name: "World Geodetic System 1984 (Transit)",
            id: {
              authority: "EPSG",
              code: 1166,
            },
          },
          {
            name: "World Geodetic System 1984 (G730)",
            id: {
              authority: "EPSG",
              code: 1152,
            },
          },
          {
            name: "World Geodetic System 1984 (G873)",
            id: {
              authority: "EPSG",
              code: 1153,
            },
          },
          {
            name: "World Geodetic System 1984 (G1150)",
            id: {
              authority: "EPSG",
              code: 1154,
            },
          },
          {
            name: "World Geodetic System 1984 (G1674)",
            id: {
              authority: "EPSG",
              code: 1155,
            },
          },
          {
            name: "World Geodetic System 1984 (G1762)",
            id: {
              authority: "EPSG",
              code: 1156,
            },
          },
          {
            name: "World Geodetic System 1984 (G2139)",
            id: {
              authority: "EPSG",
              code: 1309,
            },
          },
          {
            name: "World Geodetic System 1984 (G2296)",
            id: {
              authority: "EPSG",
              code: 1383,
            },
          },
        ],
        ellipsoid: {
          name: "WGS 84",
          semi_major_axis: 6378137,
          inverse_flattening: 298.257223563,
        },
        accuracy: "2.0",
        id: {
          authority: "EPSG",
          code: 6326,
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
      scope: "Horizontal component of 3D system.",
      area: "World.",
      bbox: {
        south_latitude: -90,
        west_longitude: -180,
        north_latitude: 90,
        east_longitude: 180,
      },
      id: {
        authority: "EPSG",
        code: 4326,
      },
    } as unknown as ProjJson,
  ],
  [
    3857,
    {
      $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
      type: "ProjectedCRS",
      name: "WGS 84 / Pseudo-Mercator",
      base_crs: {
        type: "GeographicCRS",
        name: "WGS 84",
        datum_ensemble: {
          name: "World Geodetic System 1984 ensemble",
          members: [
            {
              name: "World Geodetic System 1984 (Transit)",
              id: {
                authority: "EPSG",
                code: 1166,
              },
            },
            {
              name: "World Geodetic System 1984 (G730)",
              id: {
                authority: "EPSG",
                code: 1152,
              },
            },
            {
              name: "World Geodetic System 1984 (G873)",
              id: {
                authority: "EPSG",
                code: 1153,
              },
            },
            {
              name: "World Geodetic System 1984 (G1150)",
              id: {
                authority: "EPSG",
                code: 1154,
              },
            },
            {
              name: "World Geodetic System 1984 (G1674)",
              id: {
                authority: "EPSG",
                code: 1155,
              },
            },
            {
              name: "World Geodetic System 1984 (G1762)",
              id: {
                authority: "EPSG",
                code: 1156,
              },
            },
            {
              name: "World Geodetic System 1984 (G2139)",
              id: {
                authority: "EPSG",
                code: 1309,
              },
            },
            {
              name: "World Geodetic System 1984 (G2296)",
              id: {
                authority: "EPSG",
                code: 1383,
              },
            },
          ],
          ellipsoid: {
            name: "WGS 84",
            semi_major_axis: 6378137,
            inverse_flattening: 298.257223563,
          },
          accuracy: "2.0",
          id: {
            authority: "EPSG",
            code: 6326,
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
        id: {
          authority: "EPSG",
          code: 4326,
        },
      },
      conversion: {
        name: "Popular Visualisation Pseudo-Mercator",
        method: {
          name: "Popular Visualisation Pseudo Mercator",
          id: {
            authority: "EPSG",
            code: 1024,
          },
        },
        parameters: [
          {
            name: "Latitude of natural origin",
            value: 0,
            unit: "degree",
            id: {
              authority: "EPSG",
              code: 8801,
            },
          },
          {
            name: "Longitude of natural origin",
            value: 0,
            unit: "degree",
            id: {
              authority: "EPSG",
              code: 8802,
            },
          },
          {
            name: "False easting",
            value: 0,
            unit: "metre",
            id: {
              authority: "EPSG",
              code: 8806,
            },
          },
          {
            name: "False northing",
            value: 0,
            unit: "metre",
            id: {
              authority: "EPSG",
              code: 8807,
            },
          },
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
      scope: "Web mapping and visualisation.",
      area: "World between 85.06\u00b0S and 85.06\u00b0N.",
      bbox: {
        south_latitude: -85.06,
        west_longitude: -180,
        north_latitude: 85.06,
        east_longitude: 180,
      },
      id: {
        authority: "EPSG",
        code: 3857,
      },
    } as unknown as ProjJson,
  ],
  [
    4269,
    {
      $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
      type: "GeographicCRS",
      name: "NAD83",
      datum: {
        type: "GeodeticReferenceFrame",
        name: "North American Datum 1983",
        ellipsoid: {
          name: "GRS 1980",
          semi_major_axis: 6378137,
          inverse_flattening: 298.257222101,
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
      scope: "Geodesy.",
      area: "North America - onshore and offshore: Canada. Puerto Rico. United States (USA). US Virgin Islands. British Virgin Islands.",
      bbox: {
        south_latitude: 14.92,
        west_longitude: 167.65,
        north_latitude: 86.46,
        east_longitude: -40.73,
      },
      id: {
        authority: "EPSG",
        code: 4269,
      },
      remarks:
        "Longitude is POSITIVE EAST. The adjustment included connections to Greenland and Mexico but the system was not adopted there. For applications with an accuracy of better than 1m replaced by NAD83(HARN) in the US and PRVI and by NAD83(CSRS) in Canada.",
    } as unknown as ProjJson,
  ],
]);
