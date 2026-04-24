import { describe, expect, it } from "vitest";
import { createRootTiles } from "../../src/raster-tileset/raster-tile-traversal.js";
import type {
  TilesetDescriptor,
  TilesetLevel,
} from "../../src/raster-tileset/tileset-interface.js";
import type { Bounds } from "../../src/raster-tileset/types.js";

/**
 * Minimal fake `TilesetLevel`: top-left-origin EPSG:4326 grid. Only methods
 * `createRootTiles` touches are implemented.
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

function makeDescriptor(level: TilesetLevel): TilesetDescriptor {
  return {
    levels: [level],
    projectTo3857: identity,
    projectTo4326: identity,
    projectFrom3857: identity,
    projectFrom4326: identity,
    projectedBounds: [-180, -90, 180, 90],
  };
}

function makeViewport(bounds: Bounds) {
  return { getBounds: () => bounds };
}

describe("createRootTiles", () => {
  it("bounds a huge global single-level descriptor to a handful of root tiles for a small viewport", () => {
    // Mirror AEF: ~10 m pixels over the whole globe at 256 px tiles →
    // ~15000 × 7000 root tiles. A San Francisco-sized viewport should resolve
    // to fewer than 100 root tiles, not millions.
    const descriptor = makeDescriptor(
      makeFakeLevel({
        matrixWidth: 15665,
        matrixHeight: 7264,
        // 256 * 10 m ≈ 2.56 km ≈ 0.023° at the equator
        tileDegrees: 0.023,
      }),
    );
    const roots = createRootTiles({
      descriptor,
      viewport: makeViewport([-122.5, 37.7, -122.3, 37.9]),
      datasetWgs84Bounds: [-180, -90, 180, 90],
    });
    expect(roots.length).toBeLessThan(100);
    expect(roots.length).toBeGreaterThan(0);
  });

  it("returns an empty list when the viewport does not overlap the dataset", () => {
    const descriptor = makeDescriptor(
      makeFakeLevel({
        matrixWidth: 15665,
        matrixHeight: 7264,
        tileDegrees: 0.023,
      }),
    );
    // Dataset covers only [0, 0, 10, 10]; viewport is far away in lng.
    const roots = createRootTiles({
      descriptor,
      viewport: makeViewport([100, 0, 110, 10]),
      datasetWgs84Bounds: [0, 0, 10, 10],
    });
    expect(roots).toHaveLength(0);
  });

  it("enumerates every tile for small root matrices without projecting", () => {
    // Uncullable descriptor — projectFrom4326 throws. The small-matrix path
    // must not touch it.
    const descriptor: TilesetDescriptor = {
      levels: [
        makeFakeLevel({ matrixWidth: 3, matrixHeight: 4, tileDegrees: 90 }),
      ],
      projectTo3857: identity,
      projectTo4326: identity,
      projectFrom3857: identity,
      projectFrom4326: () => {
        throw new Error("should not be called for small root matrices");
      },
      projectedBounds: [-180, -90, 180, 90],
    };
    const roots = createRootTiles({
      descriptor,
      viewport: makeViewport([-180, -90, 180, 90]),
      datasetWgs84Bounds: [-180, -90, 180, 90],
    });
    // 3 × 4 = 12 root tiles, all enumerated.
    expect(roots).toHaveLength(12);
  });
});
