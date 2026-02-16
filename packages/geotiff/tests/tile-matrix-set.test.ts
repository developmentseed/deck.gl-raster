import { describe, expect, it } from "vitest";
import wktParser from "wkt-parser";
import { generateTileMatrixSet } from "../src/tile-matrix-set.js";
import { loadGeoTIFF } from "./helpers.js";

const EPSG_4326 = {
  $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
  type: "GeographicCRS",
  name: "WGS 84",
  datum_ensemble: {
    name: "World Geodetic System 1984 ensemble",
    members: [
      {
        name: "World Geodetic System 1984 (Transit)",
        id: { authority: "EPSG", code: 1166 },
      },
      {
        name: "World Geodetic System 1984 (G730)",
        id: { authority: "EPSG", code: 1152 },
      },
      {
        name: "World Geodetic System 1984 (G873)",
        id: { authority: "EPSG", code: 1153 },
      },
      {
        name: "World Geodetic System 1984 (G1150)",
        id: { authority: "EPSG", code: 1154 },
      },
      {
        name: "World Geodetic System 1984 (G1674)",
        id: { authority: "EPSG", code: 1155 },
      },
      {
        name: "World Geodetic System 1984 (G1762)",
        id: { authority: "EPSG", code: 1156 },
      },
      {
        name: "World Geodetic System 1984 (G2139)",
        id: { authority: "EPSG", code: 1309 },
      },
      {
        name: "World Geodetic System 1984 (G2296)",
        id: { authority: "EPSG", code: 1383 },
      },
    ],
    ellipsoid: {
      name: "WGS 84",
      semi_major_axis: 6378137,
      inverse_flattening: 298.257223563,
    },
    accuracy: "2.0",
    id: { authority: "EPSG", code: 6326 },
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
  id: { authority: "EPSG", code: 4326 },
};

describe("test TMS", () => {
  it("can generate TMS from EPSG CRS", async () => {
    const geotiff = await loadGeoTIFF(
      "uint8_rgb_deflate_block64_cog",
      "rasterio",
    );
    const crs = geotiff.crs;
    expect(crs).toEqual(4326);

    const parsedCrs = wktParser(EPSG_4326);

    const tms = generateTileMatrixSet(geotiff, parsedCrs, { id: "test-tms" });
    console.log(tms);
  });
});
