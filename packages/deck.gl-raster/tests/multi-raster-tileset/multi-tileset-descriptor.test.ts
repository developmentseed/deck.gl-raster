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

  describe("closest-finer (default)", () => {
    it("falls back to finest when all levels are coarser than primary", () => {
      // Primary at 10m — all levels (200, 60, 20) are coarser
      const selected = selectSecondaryLevel(levels, 10);
      expect(selected).toBe(levels[2]); // 20m — finest available
    });

    it("picks the coarsest level that is still finer than primary", () => {
      // Primary at 100m — finer-or-equal candidates are [60, 20]
      // Pick the coarsest among them (closest to 100m without exceeding)
      const selected = selectSecondaryLevel(levels, 100);
      expect(selected).toBe(levels[1]); // 60m
    });

    it("picks exact match when available", () => {
      const selected = selectSecondaryLevel(levels, 60);
      expect(selected).toBe(levels[1]); // 60m exact
    });
  });

  describe("closest", () => {
    it("picks the level with the smallest absolute mpp difference", () => {
      // Primary at 50m — diffs: |200-50|=150, |60-50|=10, |20-50|=30
      const selected = selectSecondaryLevel(levels, 50, "closest");
      expect(selected).toBe(levels[1]); // 60m (closest by abs diff)
    });

    it("may pick a coarser level if it is closer than all finer ones", () => {
      // Primary at 100m — diffs: |200-100|=100, |60-100|=40, |20-100|=80
      const selected = selectSecondaryLevel(levels, 100, "closest");
      expect(selected).toBe(levels[1]); // 60m
    });

    it("picks finest when primary is finer than all levels", () => {
      const selected = selectSecondaryLevel(levels, 10, "closest");
      expect(selected).toBe(levels[2]); // 20m (closest to 10m)
    });
  });
});
