import type { TileMatrix } from "./types/index.js";

/**
 * A 2-D affine transform as a six-element tuple in row-major order:
 *
 *   x_crs = a * col_px + b * row_px + c
 *   y_crs = d * col_px + e * row_px + f
 *
 * For the north-up, axis-aligned grids produced by OGC TileMatrices,
 * b and d are always zero, but the type does not enforce that.
 *
 * Note: the meaning of the two output axes depends on the
 * `orderedAxes` field of the parent TileMatrixSet, which these
 * helpers do not consult.  Axis 0 of pointOfOrigin is axis 0 of the
 * transform output, whatever that axis happens to be.
 */
export type Affine = [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

/**
 * Construct a single affine transform that maps pixel coordinates
 * within *any* tile of the matrix to CRS coordinates.
 *
 * Returns `null` when the matrix declares `variableMatrixWidths`,
 * because coalesced rows have a different X pixel size than the rest
 * and cannot be described by one transform.  Use {@link tileTransform}
 * in that case.
 *
 * Pixel (0, 0) is the top-left corner of tile (0, 0).  The column
 * pixel index runs across the full matrix:
 *   globalPixelCol = col * tileWidth  + pixelWithinTile_x
 *   globalPixelRow = row * tileHeight + pixelWithinTile_y
 */
export function matrixTransform(matrix: TileMatrix): Affine | null {
  if (matrix.variableMatrixWidths && matrix.variableMatrixWidths.length > 0) {
    return null;
  }

  const [originX, originY] = matrix.pointOfOrigin;
  const ySign = matrix.cornerOfOrigin === "bottomLeft" ? 1 : -1;

  return [
    matrix.cellSize, // a: x per pixel-col
    0, // b
    originX, // c: x origin
    0, // d
    ySign * matrix.cellSize, // e: y per pixel-row
    originY, // f: y origin
  ];
}

/**
 * Construct an affine transform for a single tile identified by its
 * column and row indices within the matrix.  Pixel (0, 0) is the
 * top-left corner of *this* tile.
 *
 * This is always possible: even when `variableMatrixWidths` is
 * present, each individual tile is a plain rectangular pixel grid
 * with a well-defined, axis-aligned footprint.  Coalescence only
 * stretches the tile in X; Y is unaffected.
 */
export function tileTransform(
  matrix: TileMatrix,
  tile: { col: number; row: number },
): Affine {
  const coalesce = coalesceForRow(matrix, tile.row);

  const [originX, originY] = matrix.pointOfOrigin;
  const ySign = matrix.cornerOfOrigin === "bottomLeft" ? 1 : -1;

  const tileSpanX = coalesce * matrix.cellSize * matrix.tileWidth;
  const tileSpanY = matrix.cellSize * matrix.tileHeight;

  return [
    coalesce * matrix.cellSize, // a: x per pixel-col (stretched by coalesce)
    0, // b
    originX + tile.col * tileSpanX, // c: x origin of this tile
    0, // d
    ySign * matrix.cellSize, // e: y per pixel-row (unchanged)
    originY + ySign * tile.row * tileSpanY, // f: y origin of this tile
  ];
}

/**
 * Return the coalesce factor for a given row, or 1 if the row is not
 * coalesced (or the matrix has no variableMatrixWidths at all).
 */
function coalesceForRow(matrix: TileMatrix, row: number): number {
  if (!matrix.variableMatrixWidths) return 1;

  for (const vmw of matrix.variableMatrixWidths) {
    if (row >= vmw.minTileRow && row <= vmw.maxTileRow) {
      return vmw.coalesce;
    }
  }

  return 1;
}
