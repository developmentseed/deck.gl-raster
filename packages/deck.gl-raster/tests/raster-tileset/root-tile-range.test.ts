import { describe, expect, it } from "vitest";
import { getRootTileRange } from "../../src/raster-tileset/raster-tile-traversal.js";
import type { TilesetLevel } from "../../src/raster-tileset/tileset-interface.js";

/**
 * Minimal fake `TilesetLevel` that delegates `crsBoundsToTileRange` to a
 * trivial EPSG:4326-aligned pixel grid. Only the methods exercised by
 * `getRootTileRange` are implemented.
 */
function makeFakeLevel(opts: {
  matrixWidth: number;
  matrixHeight: number;
  tileDegrees: number;
}): TilesetLevel {
  const { matrixWidth, matrixHeight, tileDegrees } = opts;
  return {
    matrixWidth,
    matrixHeight,
    tileWidth: 256,
    tileHeight: 256,
    metersPerPixel: 10,
    projectedTileCorners() {
      throw new Error("not used");
    },
    tileTransform() {
      throw new Error("not used");
    },
    crsBoundsToTileRange(minX, minY, maxX, maxY) {
      // Treat the "source CRS" as EPSG:4326 with top-left origin at
      // (-180, +90). Columns increase east, rows increase south.
      const minCol = Math.max(
        0,
        Math.min(matrixWidth - 1, Math.floor((minX + 180) / tileDegrees)),
      );
      const maxCol = Math.max(
        0,
        Math.min(matrixWidth - 1, Math.floor((maxX + 180) / tileDegrees)),
      );
      const minRow = Math.max(
        0,
        Math.min(matrixHeight - 1, Math.floor((90 - maxY) / tileDegrees)),
      );
      const maxRow = Math.max(
        0,
        Math.min(matrixHeight - 1, Math.floor((90 - minY) / tileDegrees)),
      );
      return { minCol, maxCol, minRow, maxRow };
    },
  };
}

/** Identity projection: source CRS already is EPSG:4326. */
const identity = (x: number, y: number): [number, number] => [x, y];

describe("getRootTileRange", () => {
  it("bounds a huge global single-level descriptor to a handful of root tiles for a small viewport", () => {
    // Mirror AEF: ~10 m pixels over the whole globe at 256 px tiles →
    // ~15000 × 7000 root tiles. A San Francisco-sized viewport should resolve
    // to fewer than 100 root tiles, not millions.
    const level = makeFakeLevel({
      matrixWidth: 15665,
      matrixHeight: 7264,
      // 256 * 10 m ≈ 2.56 km ≈ 0.023° at the equator
      tileDegrees: 0.023,
    });
    const range = getRootTileRange(level, [-122.5, 37.7, -122.3, 37.9], {
      projectFrom4326: identity,
    });
    const count =
      (range.maxCol - range.minCol + 1) * (range.maxRow - range.minRow + 1);
    expect(count).toBeLessThan(100);
  });

  it("collapses to a single tile when the viewport lies inside one tile", () => {
    const level = makeFakeLevel({
      matrixWidth: 100,
      matrixHeight: 50,
      tileDegrees: 3.6,
    });
    // Tile 50,25 covers roughly (0°..3.6°, -3.6°..0°). A viewport strictly
    // inside that tile should select exactly one root tile.
    const range = getRootTileRange(level, [0.5, -1, 1.5, -0.5], {
      projectFrom4326: identity,
    });
    expect(range.maxCol - range.minCol).toBe(0);
    expect(range.maxRow - range.minRow).toBe(0);
  });
});
