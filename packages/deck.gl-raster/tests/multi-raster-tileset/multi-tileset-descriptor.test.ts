import { describe, expect, it } from "vitest";
import {
  createMultiTilesetDescriptor,
  selectSecondaryLevel,
  tilesetLevelsEqual,
} from "../../src/multi-raster-tileset/multi-tileset-descriptor.js";
import type {
  TilesetDescriptor,
  TilesetLevel,
} from "../../src/raster-tileset/tileset-interface.js";
import type { Corners } from "../../src/raster-tileset/types.js";

/** Helper: create a mock TilesetLevel */
function mockLevel(opts: {
  matrixWidth: number;
  matrixHeight: number;
  tileWidth: number;
  tileHeight: number;
  metersPerPixel: number;
}): TilesetLevel {
  return {
    ...opts,
    projectedTileCorners: (_col: number, _row: number): Corners => ({
      topLeft: [0, 1],
      topRight: [1, 1],
      bottomLeft: [0, 0],
      bottomRight: [1, 0],
    }),
    crsBoundsToTileRange: () => ({
      minCol: 0,
      maxCol: 0,
      minRow: 0,
      maxRow: 0,
    }),
  };
}

/** Helper: create a mock TilesetDescriptor */
function mockDescriptor(levels: TilesetLevel[]): TilesetDescriptor {
  const identity = (x: number, y: number): [number, number] => [x, y];
  return {
    levels,
    projectTo3857: identity,
    projectTo4326: identity,
    projectedBounds: [600000, 7890000, 710000, 8000000],
  };
}

describe("tilesetLevelsEqual", () => {
  it("returns true for levels with same grid parameters", () => {
    const a = mockLevel({
      matrixWidth: 43,
      matrixHeight: 43,
      tileWidth: 256,
      tileHeight: 256,
      metersPerPixel: 10,
    });
    const b = mockLevel({
      matrixWidth: 43,
      matrixHeight: 43,
      tileWidth: 256,
      tileHeight: 256,
      metersPerPixel: 10,
    });
    expect(tilesetLevelsEqual(a, b)).toBe(true);
  });

  it("returns false for levels with different grid parameters", () => {
    const a = mockLevel({
      matrixWidth: 43,
      matrixHeight: 43,
      tileWidth: 256,
      tileHeight: 256,
      metersPerPixel: 10,
    });
    const b = mockLevel({
      matrixWidth: 22,
      matrixHeight: 22,
      tileWidth: 256,
      tileHeight: 256,
      metersPerPixel: 20,
    });
    expect(tilesetLevelsEqual(a, b)).toBe(false);
  });
});

describe("createMultiTilesetDescriptor", () => {
  it("selects the finest-resolution tileset as primary", () => {
    const fine = mockDescriptor([
      mockLevel({
        matrixWidth: 1,
        matrixHeight: 1,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 100,
      }),
      mockLevel({
        matrixWidth: 43,
        matrixHeight: 43,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 10,
      }),
    ]);
    const coarse = mockDescriptor([
      mockLevel({
        matrixWidth: 1,
        matrixHeight: 1,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 200,
      }),
      mockLevel({
        matrixWidth: 22,
        matrixHeight: 22,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 20,
      }),
    ]);
    const multi = createMultiTilesetDescriptor(
      new Map([
        ["red", fine],
        ["swir", coarse],
      ]),
    );
    expect(multi.primary).toBe(fine);
    expect(multi.secondaries.size).toBe(1);
    expect(multi.secondaries.get("swir")).toBe(coarse);
  });

  it("does not include the primary key in secondaries", () => {
    const fine = mockDescriptor([
      mockLevel({
        matrixWidth: 43,
        matrixHeight: 43,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 10,
      }),
    ]);
    const coarse = mockDescriptor([
      mockLevel({
        matrixWidth: 22,
        matrixHeight: 22,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 20,
      }),
    ]);
    const multi = createMultiTilesetDescriptor(
      new Map([
        ["red", fine],
        ["swir", coarse],
      ]),
    );
    expect(multi.secondaries.has("red")).toBe(false);
  });
});

describe("selectSecondaryLevel", () => {
  it("picks the finest level that is >= primary metersPerPixel", () => {
    const levels = [
      mockLevel({
        matrixWidth: 1,
        matrixHeight: 1,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 200,
      }),
      mockLevel({
        matrixWidth: 5,
        matrixHeight: 5,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 60,
      }),
      mockLevel({
        matrixWidth: 22,
        matrixHeight: 22,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 20,
      }),
    ];
    const selected = selectSecondaryLevel(levels, 10);
    expect(selected).toBe(levels[2]);
  });

  it("returns the finest level when all are coarser than primary", () => {
    const levels = [
      mockLevel({
        matrixWidth: 1,
        matrixHeight: 1,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 200,
      }),
      mockLevel({
        matrixWidth: 3,
        matrixHeight: 3,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 60,
      }),
    ];
    const selected = selectSecondaryLevel(levels, 10);
    expect(selected).toBe(levels[1]);
  });

  it("selects a coarser level when primary is zoomed out", () => {
    const levels = [
      mockLevel({
        matrixWidth: 1,
        matrixHeight: 1,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 200,
      }),
      mockLevel({
        matrixWidth: 5,
        matrixHeight: 5,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 60,
      }),
      mockLevel({
        matrixWidth: 22,
        matrixHeight: 22,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 20,
      }),
    ];
    const selected = selectSecondaryLevel(levels, 100);
    expect(selected).toBe(levels[1]);
  });
});
