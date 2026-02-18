import * as affine from "@developmentseed/affine";
import { tileTransform } from "./transform";
import type { BoundingBox, TileMatrix, TileMatrixSet } from "./types";
import { narrowTileMatrixSet } from "./utils";

/**
 * Return the bounding box of the tile in the TMS's native coordinate reference
 * system.
 */
export function xy_bounds(
  matrix: TileMatrix,
  tile: { x: number; y: number },
): BoundingBox;
/**
 * Return the bounding box of the tile in the TMS's native coordinate reference
 * system.
 */
export function xy_bounds(
  matrixSet: TileMatrixSet,
  tile: { x: number; y: number; z: number },
): BoundingBox;
export function xy_bounds(
  input: TileMatrix | TileMatrixSet,
  tile: { x: number; y: number; z?: number },
): BoundingBox {
  const tileMatrix = getTileMatrix(input, tile);
  const { tileHeight, tileWidth } = tileMatrix;
  const { x, y } = tile;
  const tileAffine = tileTransform(tileMatrix, { col: x, row: y });

  // Apply affine to local tile pixel corners (0,0) is the origin corner,
  // (tileWidth, tileHeight) is the opposite corner.
  const [x0, y0] = affine.apply(tileAffine, 0, 0);
  const [x1, y1] = affine.apply(tileAffine, tileWidth, tileHeight);

  if (tileMatrix.cornerOfOrigin === "bottomLeft") {
    // (x0, y0) is bottom-left, (x1, y1) is top-right
    return { lowerLeft: [x0, y0], upperRight: [x1, y1] };
  }

  // topLeft (default): (x0, y0) is top-left, (x1, y1) is bottom-right
  return { lowerLeft: [x0, y1], upperRight: [x1, y0] };
}

function getTileMatrix(
  input: TileMatrix | TileMatrixSet,
  tile: { x: number; y: number; z?: number },
): TileMatrix {
  if (narrowTileMatrixSet(input)) {
    if (tile.z === undefined) {
      throw new Error("Tile z level is required when input is a TileMatrixSet");
    }
    const tileMatrix = input.tileMatrices[tile.z];
    if (!tileMatrix) {
      throw new Error(
        `Tile z level ${tile.z} is out of bounds for TileMatrixSet with ${input.tileMatrices.length} levels.`,
      );
    }

    return tileMatrix;
  } else {
    return input;
  }
}
