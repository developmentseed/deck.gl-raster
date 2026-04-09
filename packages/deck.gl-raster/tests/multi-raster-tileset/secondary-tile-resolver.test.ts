import { describe, expect, it } from "vitest";
import { resolveSecondaryTiles } from "../../src/multi-raster-tileset/secondary-tile-resolver.js";
import type { TilesetLevel } from "../../src/raster-tileset/tileset-interface.js";
import type { Corners, Point } from "../../src/raster-tileset/types.js";

/**
 * Create a mock TilesetLevel backed by a regular grid.
 * originX/originY is the top-left corner. cellSize is CRS units per pixel.
 */
function gridLevel(opts: {
  originX: number;
  originY: number;
  cellSize: number;
  tileWidth: number;
  tileHeight: number;
  matrixWidth: number;
  matrixHeight: number;
}): TilesetLevel {
  const { originX, originY, cellSize, tileWidth, tileHeight, matrixWidth, matrixHeight } = opts;
  const tileCrsWidth = tileWidth * cellSize;
  const tileCrsHeight = tileHeight * cellSize;
  return {
    matrixWidth, matrixHeight, tileWidth, tileHeight,
    metersPerPixel: cellSize,
    projectedTileCorners: (col: number, row: number): Corners => {
      const minX = originX + col * tileCrsWidth;
      const maxX = minX + tileCrsWidth;
      const maxY = originY - row * tileCrsHeight;
      const minY = maxY - tileCrsHeight;
      return {
        topLeft: [minX, maxY] as Point, topRight: [maxX, maxY] as Point,
        bottomLeft: [minX, minY] as Point, bottomRight: [maxX, minY] as Point,
      };
    },
    crsBoundsToTileRange: (projectedMinX: number, projectedMinY: number, projectedMaxX: number, projectedMaxY: number) => {
      // Use ceil-1 for both min and max so that exact tile boundaries are treated
      // as inclusive on the left tile (the boundary point belongs to the tile ending there).
      let minCol = Math.ceil((projectedMinX - originX) / tileCrsWidth) - 1;
      let maxCol = Math.ceil((projectedMaxX - originX) / tileCrsWidth) - 1;
      let minRow = Math.ceil((originY - projectedMaxY) / tileCrsHeight) - 1;
      let maxRow = Math.ceil((originY - projectedMinY) / tileCrsHeight) - 1;
      minCol = Math.max(0, Math.min(matrixWidth - 1, minCol));
      maxCol = Math.max(0, Math.min(matrixWidth - 1, maxCol));
      minRow = Math.max(0, Math.min(matrixHeight - 1, minRow));
      maxRow = Math.max(0, Math.min(matrixHeight - 1, maxRow));
      return { minCol, maxCol, minRow, maxRow };
    },
  };
}

describe("resolveSecondaryTiles", () => {
  // Both grids share origin (600000, 8000000), top-left convention.
  // Primary: 10m, 256px tiles → each tile covers 2560m
  // Secondary: 20m, 256px tiles → each tile covers 5120m
  const origin = { x: 600000, y: 8000000 };
  const primaryLevel = gridLevel({ originX: origin.x, originY: origin.y, cellSize: 10, tileWidth: 256, tileHeight: 256, matrixWidth: 43, matrixHeight: 43 });
  const secondaryLevel = gridLevel({ originX: origin.x, originY: origin.y, cellSize: 20, tileWidth: 256, tileHeight: 256, matrixWidth: 22, matrixHeight: 22 });

  it("returns correct UV transform when primary tile is fully inside one secondary tile", () => {
    // Primary tile (0,0) covers [600000, 7997440] to [602560, 8000000]
    // Secondary tile (0,0) covers [600000, 7994880] to [605120, 8000000]
    const result = resolveSecondaryTiles(primaryLevel, 0, 0, secondaryLevel);
    expect(result.tileIndices).toEqual([{ col: 0, row: 0 }]);
    // scaleX = 2560 / 5120 = 0.5, offsetX = 0, offsetY = 0
    expect(result.uvTransform[0]).toBeCloseTo(0);
    expect(result.uvTransform[1]).toBeCloseTo(0);
    expect(result.uvTransform[2]).toBeCloseTo(0.5);
    expect(result.uvTransform[3]).toBeCloseTo(0.5);
  });

  it("computes correct UV offset for non-origin primary tile", () => {
    // Primary tile (1,0): covers [602560, 7997440] to [605120, 8000000]
    // Still inside secondary tile (0,0): [600000, 7994880] to [605120, 8000000]
    const result = resolveSecondaryTiles(primaryLevel, 1, 0, secondaryLevel);
    expect(result.tileIndices).toEqual([{ col: 0, row: 0 }]);
    // offsetX = (602560 - 600000) / 5120 = 0.5
    expect(result.uvTransform[0]).toBeCloseTo(0.5);
    expect(result.uvTransform[1]).toBeCloseTo(0);
    expect(result.uvTransform[2]).toBeCloseTo(0.5);
    expect(result.uvTransform[3]).toBeCloseTo(0.5);
  });

  it("handles primary tile spanning two secondary tiles", () => {
    // Primary tile (2,0): covers [605120, 7997440] to [607680, 8000000]
    // Crosses boundary between secondary (0,0) and (1,0)
    const result = resolveSecondaryTiles(primaryLevel, 2, 0, secondaryLevel);
    expect(result.tileIndices.length).toBe(2);
    // Stitched: [600000..610240], width=10240
    // scaleX = 2560 / 10240 = 0.25, offsetX = (605120-600000)/10240 = 0.5
    expect(result.uvTransform[2]).toBeCloseTo(0.25);
    expect(result.uvTransform[0]).toBeCloseTo(0.5);
  });

  it("returns identity-like transform when grids align exactly", () => {
    const result = resolveSecondaryTiles(primaryLevel, 0, 0, primaryLevel);
    expect(result.tileIndices).toEqual([{ col: 0, row: 0 }]);
    expect(result.uvTransform[0]).toBeCloseTo(0);
    expect(result.uvTransform[1]).toBeCloseTo(0);
    expect(result.uvTransform[2]).toBeCloseTo(1);
    expect(result.uvTransform[3]).toBeCloseTo(1);
  });
});
