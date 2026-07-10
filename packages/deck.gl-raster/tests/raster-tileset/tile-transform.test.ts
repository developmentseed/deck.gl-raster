import type { TileMatrixSet } from "@developmentseed/morecantile";
import { describe, expect, it } from "vitest";
import { TileMatrixSetAdaptor } from "../../src/raster-tileset/tile-matrix-set.js";

const MOCK_TMS: TileMatrixSet = {
  id: "test",
  crs: { uri: "http://www.opengis.net/def/crs/EPSG/0/4326" },
  boundingBox: {
    lowerLeft: [0, 0],
    upperRight: [1, 1],
  },
  tileMatrices: [
    {
      id: "0",
      scaleDenominator: 1000,
      cellSize: 0.5,
      cornerOfOrigin: "topLeft" as const,
      pointOfOrigin: [0, 1],
      tileWidth: 2,
      tileHeight: 2,
      matrixWidth: 1,
      matrixHeight: 1,
    },
  ],
};

const identityProjection = (x: number, y: number): [number, number] => [x, y];

describe("TileMatrixSetAdaptor.tileTransform", () => {
  const adaptor = new TileMatrixSetAdaptor(MOCK_TMS, {
    projectTo4326: identityProjection,
    projectFrom4326: identityProjection,
    projectTo3857: identityProjection,
    projectFrom3857: identityProjection,
  });
  const level = adaptor.levels[0]!;

  it("maps the top-left pixel of tile (0,0) to the tile origin", () => {
    const { forwardTransform } = level.tileTransform(0, 0);
    const [x, y] = forwardTransform(0, 0);
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(1, 10); // top-left of bbox in a topLeft-origin TMS
  });

  it("maps the bottom-right pixel of tile (0,0) to the opposite corner", () => {
    const { forwardTransform } = level.tileTransform(0, 0);
    // tile is 2x2 pixels, cellSize = 0.5 → covers 1 CRS unit
    const [x, y] = forwardTransform(2, 2);
    expect(x).toBeCloseTo(1, 10);
    expect(y).toBeCloseTo(0, 10);
  });

  it("forwardTransform then inverseTransform round-trips", () => {
    const { forwardTransform, inverseTransform } = level.tileTransform(0, 0);
    const [x, y] = forwardTransform(1.3, 0.7);
    const [px, py] = inverseTransform(x, y);
    expect(px).toBeCloseTo(1.3, 10);
    expect(py).toBeCloseTo(0.7, 10);
  });
});
