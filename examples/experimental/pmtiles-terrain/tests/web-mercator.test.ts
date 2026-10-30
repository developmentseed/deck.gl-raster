import { describe, expect, it } from "vitest";
import {
  cellSize,
  groundCellSize,
  tileMercatorYRange,
  webMercatorQuad,
} from "../src/web-mercator.js";

/** Half the width of the Web Mercator world, in meters: pi * 6378137. */
const HALF = 20037508.342789244;

describe("cellSize", () => {
  it("covers the world with one 512 px tile at z0", () => {
    expect(cellSize(0, 512)).toBeCloseTo(78271.51696402048, 6);
  });

  it("halves with each zoom", () => {
    expect(cellSize(12, 512)).toBeCloseTo(19.109257071294063, 9);
  });
});

describe("tileMercatorYRange", () => {
  it("spans the whole world at z0", () => {
    expect(tileMercatorYRange(0, 0)).toEqual([HALF, -HALF]);
  });

  it("puts the second row of z1 below the equator", () => {
    expect(tileMercatorYRange(1, 1)).toEqual([0, -HALF]);
  });

  it("gives an interior row's north and south edges", () => {
    expect(tileMercatorYRange(2, 1)).toEqual([HALF / 2, 0]);
  });
});

describe("groundCellSize", () => {
  it("is the projected size at the equator", () => {
    expect(groundCellSize(10, 0)).toBe(10);
  });

  it("is half the projected size at 60°N", () => {
    // Mercator y of 60°N: 6378137 * ln(tan(75°)).
    expect(groundCellSize(10, 8399737.889818355)).toBeCloseTo(5, 6);
  });

  it("is symmetric about the equator", () => {
    expect(groundCellSize(10, -8399737.889818355)).toBeCloseTo(5, 6);
  });
});

describe("webMercatorQuad", () => {
  const tms = webMercatorQuad({ tileSize: 512, maxZoom: 12 });

  it("has one level per zoom from 0 to maxZoom", () => {
    expect(tms.tileMatrices.map((m) => m.id)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);
  });

  it("is EPSG:3857", () => {
    expect(tms.crs).toBe("http://www.opengis.net/def/crs/EPSG/0/3857");
  });

  it("describes z12 as 4096 x 4096 tiles of 512 px from the top-left corner", () => {
    expect(tms.tileMatrices[12]).toMatchObject({
      matrixWidth: 4096,
      matrixHeight: 4096,
      tileWidth: 512,
      tileHeight: 512,
      cornerOfOrigin: "topLeft",
      pointOfOrigin: [-HALF, HALF],
    });
    expect(tms.tileMatrices[12]!.cellSize).toBeCloseTo(19.109257071294063, 9);
  });

  it("gives z0 the scale of OGC WebMercatorQuad's z1, which has the same cell size", () => {
    expect(tms.tileMatrices[0]!.scaleDenominator).toBeCloseTo(
      279541132.014358,
      5,
    );
  });
});
