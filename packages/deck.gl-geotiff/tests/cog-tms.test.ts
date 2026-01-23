import { fromUrl } from "geotiff";
import { describe, expect, it } from "vitest";
import { parseCOGTileMatrixSet, __TEST_EXPORTS as TestExports } from "../src";
import { epsgIoGeoKeyParser } from "../src/proj";

describe("create TileMatrixSet from COG", () => {
  it("creates TMS", async () => {
    const url =
      "https://ds-wheels.s3.us-east-1.amazonaws.com/m_4007307_sw_18_060_20220803.tif";

    const tiff = await fromUrl(url);
    const tms = await parseCOGTileMatrixSet(tiff, epsgIoGeoKeyParser);

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
        geotransform: [
          19.231788079470196, 0, 647118, 0, -19.231788079470196, 4533600,
        ],
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
        geotransform: [9.6, 0, 647118, 0, -9.6, 4533600],
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
        geotransform: [4.8, 0, 647118, 0, -4.8, 4533600],
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
        geotransform: [2.4, 0, 647118, 0, -2.4, 4533600],
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
        geotransform: [1.2, 0, 647118, 0, -1.2, 4533600],
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
        geotransform: [0.6, 0, 647118, 0, -0.6, 4533600],
      },
    ];

    expect(tms.tileMatrices).toStrictEqual(expectedTileMatrices);
  });
});

describe("metersPerUnit", () => {
  it("handles lowercase us survey foot", () => {
    // @ts-expect-error testing case insensitivity with standard casing
    expect(TestExports.metersPerUnit({}, "us survey foot")).toBe(1200 / 3937);
  });

  it("handles mixed case US Survey Foot", () => {
    // @ts-expect-error testing case insensitivity with non-standard casing
    expect(TestExports.metersPerUnit({}, "US Survey Foot")).toBe(1200 / 3937);
  });
});
