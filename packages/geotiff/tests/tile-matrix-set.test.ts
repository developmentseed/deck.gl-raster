import { describe, expect, it } from "vitest";
import wktParser from "wkt-parser";
import { GeoTIFF } from "../src/geotiff.js";
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

    expect(tms.crs).toEqual({
      uri: "http://www.opengis.net/def/crs/EPSG/0/4326",
    });
    expect(tms.boundingBox).toEqual({
      lowerLeft: [0.0, -1.28],
      upperRight: [1.28, 0.0],
      crs: { uri: "http://www.opengis.net/def/crs/EPSG/0/4326" },
    });
    expect(tms.tileMatrices).toEqual([
      {
        id: "0",
        scaleDenominator: 7951392.199519542,
        cellSize: 0.02,
        cornerOfOrigin: "topLeft",
        pointOfOrigin: [0.0, 0.0],
        tileWidth: 64,
        tileHeight: 64,
        matrixWidth: 1,
        matrixHeight: 1,
      },
      {
        id: "1",
        scaleDenominator: 3975696.099759771,
        cellSize: 0.01,
        cornerOfOrigin: "topLeft",
        pointOfOrigin: [0.0, 0.0],
        tileWidth: 64,
        tileHeight: 64,
        matrixWidth: 2,
        matrixHeight: 2,
      },
    ]);
  });
});

describe("create TileMatrixSet from COG", () => {
  it("creates TMS", async () => {
    const url =
      "https://ds-wheels.s3.us-east-1.amazonaws.com/m_4007307_sw_18_060_20220803.tif";

    const geotiff = await GeoTIFF.fromUrl(url);

    const tms = generateTileMatrixSet(geotiff, { units: "m" });

    const expectedTileMatrices = [
      {
        id: "0",
        scaleDenominator: 68684.95742667928,
        cellSize: 19.231788079470196,
        pointOfOrigin: [647118, 4533600],
        tileWidth: 512,
        tileHeight: 512,
        matrixWidth: 1,
        matrixHeight: 1,
        cornerOfOrigin: "topLeft",
      },
      {
        id: "1",
        scaleDenominator: 34285.71428571429,
        cellSize: 9.6,
        pointOfOrigin: [647118, 4533600],
        tileWidth: 512,
        tileHeight: 512,
        matrixWidth: 2,
        matrixHeight: 2,
        cornerOfOrigin: "topLeft",
      },
      {
        id: "2",
        scaleDenominator: 17142.857142857145,
        cellSize: 4.8,
        pointOfOrigin: [647118, 4533600],
        tileWidth: 512,
        tileHeight: 512,
        matrixWidth: 3,
        matrixHeight: 4,
        cornerOfOrigin: "topLeft",
      },
      {
        id: "3",
        scaleDenominator: 8571.428571428572,
        cellSize: 2.4,
        pointOfOrigin: [647118, 4533600],
        tileWidth: 512,
        tileHeight: 512,
        matrixWidth: 5,
        matrixHeight: 7,
        cornerOfOrigin: "topLeft",
      },
      {
        id: "4",
        scaleDenominator: 4285.714285714286,
        cellSize: 1.2,
        pointOfOrigin: [647118, 4533600],
        tileWidth: 512,
        tileHeight: 512,
        matrixWidth: 10,
        matrixHeight: 13,
        cornerOfOrigin: "topLeft",
      },
      {
        id: "5",
        scaleDenominator: 2142.857142857143,
        cellSize: 0.6,
        pointOfOrigin: [647118, 4533600],
        tileWidth: 512,
        tileHeight: 512,
        matrixWidth: 19,
        matrixHeight: 25,
        cornerOfOrigin: "topLeft",
      },
    ];

    expect(tms.tileMatrices).toStrictEqual(expectedTileMatrices);
  });
});
