import * as affine from "@developmentseed/affine";
import { describe, expect, it } from "vitest";
import { resolveSecondaryTiles } from "../../src/multi-raster-tileset/secondary-tile-resolver.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";
import { overlappingTileSpan } from "../../src/raster-tileset/tile-span.js";
import type { RasterTilesetLevel } from "../../src/raster-tileset/tileset-interface.js";
import type { Corners, Point } from "../../src/raster-tileset/types.js";

/**
 * Create a mock RasterTilesetLevel backed by a regular grid.
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
}): RasterTilesetLevel {
  const {
    originX,
    originY,
    cellSize,
    tileWidth,
    tileHeight,
    matrixWidth,
    matrixHeight,
  } = opts;
  const tileCrsWidth = tileWidth * cellSize;
  const tileCrsHeight = tileHeight * cellSize;
  return {
    matrixWidth,
    matrixHeight,
    tileWidth,
    tileHeight,
    metersPerPixel: cellSize,
    tileTransform: (col: number, row: number) => {
      const tileX = originX + col * tileCrsWidth;
      const tileY = originY - row * tileCrsHeight;
      return {
        forwardTransform: (px: number, py: number): [number, number] => [
          tileX + px * cellSize,
          tileY - py * cellSize,
        ],
        inverseTransform: (x: number, y: number): [number, number] => [
          (x - tileX) / cellSize,
          (tileY - y) / cellSize,
        ],
      };
    },
    projectedTileCorners: (col: number, row: number): Corners => {
      const minX = originX + col * tileCrsWidth;
      const maxX = minX + tileCrsWidth;
      const maxY = originY - row * tileCrsHeight;
      const minY = maxY - tileCrsHeight;
      return {
        topLeft: [minX, maxY] as Point,
        topRight: [maxX, maxY] as Point,
        bottomLeft: [minX, minY] as Point,
        bottomRight: [maxX, minY] as Point,
      };
    },
    crsBoundsToTileRange: (
      projectedMinX: number,
      projectedMinY: number,
      projectedMaxX: number,
      projectedMaxY: number,
    ) => {
      // Tiles that only share an edge with the box are left out, as the
      // `RasterTilesetLevel` contract requires.
      let [minCol, maxCol] = overlappingTileSpan(
        (projectedMinX - originX) / tileCrsWidth,
        (projectedMaxX - originX) / tileCrsWidth,
      );
      let [minRow, maxRow] = overlappingTileSpan(
        (originY - projectedMaxY) / tileCrsHeight,
        (originY - projectedMinY) / tileCrsHeight,
      );
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
  const primaryLevel = gridLevel({
    originX: origin.x,
    originY: origin.y,
    cellSize: 10,
    tileWidth: 256,
    tileHeight: 256,
    matrixWidth: 43,
    matrixHeight: 43,
  });
  const secondaryLevel = gridLevel({
    originX: origin.x,
    originY: origin.y,
    cellSize: 20,
    tileWidth: 256,
    tileHeight: 256,
    matrixWidth: 22,
    matrixHeight: 22,
  });

  it("returns correct UV transform when primary tile is fully inside one secondary tile", () => {
    // Primary tile (0,0) covers [600000, 7997440] to [602560, 8000000]
    // Secondary tile (0,0) covers [600000, 7994880] to [605120, 8000000]
    const result = resolveSecondaryTiles(primaryLevel, 0, 0, secondaryLevel, 0);
    expect(result.tileIndices).toEqual([{ x: 0, y: 0 }]);
    // scaleX = 2560 / 5120 = 0.5, offsetX = 0, offsetY = 0
    expect(result.uvTransform[0]).toBeCloseTo(0);
    expect(result.uvTransform[1]).toBeCloseTo(0);
    expect(result.uvTransform[2]).toBeCloseTo(0.5);
    expect(result.uvTransform[3]).toBeCloseTo(0.5);
  });

  it("computes correct UV offset for non-origin primary tile", () => {
    // Primary tile (1,0): covers [602560, 7997440] to [605120, 8000000]
    // Still inside secondary tile (0,0): [600000, 7994880] to [605120, 8000000]
    const result = resolveSecondaryTiles(primaryLevel, 1, 0, secondaryLevel, 0);
    expect(result.tileIndices).toEqual([{ x: 0, y: 0 }]);
    // offsetX = (602560 - 600000) / 5120 = 0.5
    expect(result.uvTransform[0]).toBeCloseTo(0.5);
    expect(result.uvTransform[1]).toBeCloseTo(0);
    expect(result.uvTransform[2]).toBeCloseTo(0.5);
    expect(result.uvTransform[3]).toBeCloseTo(0.5);
  });

  it("handles primary tile spanning two secondary tiles", () => {
    // Secondary grid shifted left by half a primary tile, so its column
    // boundaries fall at 603840, 608960, ...
    const shiftedSecondary = gridLevel({
      originX: origin.x - 1280,
      originY: origin.y,
      cellSize: 20,
      tileWidth: 256,
      tileHeight: 256,
      matrixWidth: 22,
      matrixHeight: 22,
    });
    // Primary tile (1,0): covers [602560, 7997440] to [605120, 8000000]
    // Crosses the boundary at 603840 between secondary (0,0) and (1,0)
    const result = resolveSecondaryTiles(
      primaryLevel,
      1,
      0,
      shiftedSecondary,
      0,
    );
    expect(result.tileIndices).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    // Stitched: [598720..608960], width=10240
    // scaleX = 2560 / 10240 = 0.25, offsetX = (602560-598720)/10240 = 0.375
    expect(result.uvTransform[2]).toBeCloseTo(0.25);
    expect(result.uvTransform[0]).toBeCloseTo(0.375);
    // Two whole 256 px tiles side by side
    expect(result.stitchedWidth).toBe(512);
    expect(result.stitchedHeight).toBe(256);
  });

  it("fetches one 20 m tile for a 10 m tile whose edges lie on its edges", () => {
    // Sentinel-2-like 10 m and 20 m bands with 1024 px tiles. Primary tile
    // (1,1) is the bottom-right quarter of secondary tile (0,0): its right and
    // bottom edges are secondary tile edges.
    const transform: affine.Affine = [10, 0, 600000, 0, -10, 5000040];
    const primary = new AffineTilesetLevel({
      affine: transform,
      arrayWidth: 10980,
      arrayHeight: 10980,
      tileWidth: 1024,
      tileHeight: 1024,
      mpu: 1,
    });
    const secondary = new AffineTilesetLevel({
      affine: affine.compose(transform, affine.scale(2)),
      arrayWidth: 5490,
      arrayHeight: 5490,
      tileWidth: 1024,
      tileHeight: 1024,
      mpu: 1,
    });
    const result = resolveSecondaryTiles(primary, 1, 1, secondary, 0);
    expect(result.tileIndices).toEqual([{ x: 0, y: 0 }]);
  });

  it("maps an edge tile onto secondary tiles clipped to their array", () => {
    // 1 CRS unit per primary pixel, 2 per secondary pixel; both arrays cover
    // x in [0, 10] and y in [90, 100]. Primary tile (1, 1) holds pixels
    // [6, 10] x [6, 10]: x in [6, 10], y in [90, 94]. It overlaps all four
    // secondary tiles, whose last column and row hold one pixel each.
    const origin = affine.translation(0, 100);
    const primary = new AffineTilesetLevel({
      affine: affine.compose(origin, affine.scale(1, -1)),
      arrayWidth: 10,
      arrayHeight: 10,
      tileWidth: 6,
      tileHeight: 6,
      mpu: 1,
    });
    const secondary = new AffineTilesetLevel({
      affine: affine.compose(origin, affine.scale(2, -2)),
      arrayWidth: 5,
      arrayHeight: 5,
      tileWidth: 4,
      tileHeight: 4,
      mpu: 1,
    });

    const result = resolveSecondaryTiles(primary, 1, 1, secondary, 0);

    expect(result.tileIndices).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    // The stitched texture is 4 + 1 pixels each way: x in [0, 10] and y in
    // [90, 100]. The primary tile starts 6 of those 10 units in and spans 4.
    expect(result.stitchedWidth).toBe(5);
    expect(result.stitchedHeight).toBe(5);
    expect(result.uvTransform[0]).toBeCloseTo(0.6);
    expect(result.uvTransform[1]).toBeCloseTo(0.6);
    expect(result.uvTransform[2]).toBeCloseTo(0.4);
    expect(result.uvTransform[3]).toBeCloseTo(0.4);
  });

  it("returns identity-like transform when grids align exactly", () => {
    const result = resolveSecondaryTiles(primaryLevel, 0, 0, primaryLevel, 0);
    expect(result.tileIndices).toEqual([{ x: 0, y: 0 }]);
    expect(result.uvTransform[0]).toBeCloseTo(0);
    expect(result.uvTransform[1]).toBeCloseTo(0);
    expect(result.uvTransform[2]).toBeCloseTo(1);
    expect(result.uvTransform[3]).toBeCloseTo(1);
  });
});
