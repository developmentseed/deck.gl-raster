import type { TilesetLevel } from "../raster-tileset/tileset-interface.js";

/**
 * A tile index in a secondary tileset.
 *
 * Uses `x`/`y` naming to match {@link TileIndex} convention.
 *
 * @see {@link SecondaryTileResolution}
 */
export interface SecondaryTileIndex {
  /** Column index of the secondary tile. */
  x: number;
  /** Row index of the secondary tile. */
  y: number;
}

/**
 * Result of resolving secondary tiles for a primary tile.
 *
 * @see {@link resolveSecondaryTiles}
 */
export interface SecondaryTileResolution {
  /**
   * The secondary tile indices that cover the primary tile's extent.
   *
   * When the primary tile falls within a single secondary tile, this array
   * has one element. When the primary tile straddles a boundary, it may
   * contain multiple entries that must be stitched together.
   */
  tileIndices: SecondaryTileIndex[];

  /**
   * UV transform: `[offsetX, offsetY, scaleX, scaleY]`.
   *
   * Maps from the primary tile's UV space [0,1]^2 to the correct sub-region
   * of the stitched secondary texture.
   *
   * Usage in shader: `sampledUV = uv * scale + offset`
   *
   * - `offsetX`, `offsetY`: top-left corner of the primary tile's footprint
   *   within the stitched texture, in UV units.
   * - `scaleX`, `scaleY`: fraction of the stitched texture covered by the
   *   primary tile.
   */
  uvTransform: [number, number, number, number];

  /**
   * The total stitched texture width in pixels.
   *
   * Equals `(maxCol - minCol + 1) * secondaryLevel.tileWidth`.
   */
  stitchedWidth: number;

  /**
   * The total stitched texture height in pixels.
   *
   * Equals `(maxRow - minRow + 1) * secondaryLevel.tileHeight`.
   */
  stitchedHeight: number;

  /**
   * The minimum column index of the secondary tile range.
   *
   * Used when stitching: tells you where each fetched tile goes in the
   * stitched buffer (tile at column `col` starts at pixel
   * `(col - minCol) * tileWidth`).
   */
  minCol: number;

  /**
   * The minimum row index of the secondary tile range.
   *
   * Used when stitching: tells you where each fetched tile goes in the
   * stitched buffer (tile at row `row` starts at pixel
   * `(row - minRow) * tileHeight`).
   */
  minRow: number;

  /**
   * Zoom level index into {@link TilesetDescriptor.levels}.
   *
   * All tiles in {@link tileIndices} come from this same level. Tells the
   * consumer which COG overview to fetch from.
   */
  z: number;
}

/**
 * Resolve which secondary tiles cover a primary tile's extent, and compute
 * the UV transform to map from primary UV space into the stitched secondary
 * texture.
 *
 * The UV transform `[offsetX, offsetY, scaleX, scaleY]` is intended for use
 * in a shader as `sampledUV = uv * scale + offset`, where `uv` is the
 * primary tile's local UV coordinate in [0,1]^2.
 *
 * The Y axis follows a top-left convention: origin is at the top-left corner,
 * Y increases downward in texture/UV space. CRS coordinates may increase
 * upward (north), so `offsetY` is computed as
 * `(stitchedMaxY - primaryMaxY) / stitchedCrsHeight` to account for the flip.
 *
 * @param primaryLevel - The {@link TilesetLevel} describing the primary tileset.
 * @param primaryCol - Column index of the primary tile.
 * @param primaryRow - Row index of the primary tile.
 * @param secondaryLevel - The {@link TilesetLevel} describing the secondary tileset.
 * @param secondaryZ - The zoom level index of `secondaryLevel` within its
 *   {@link TilesetDescriptor.levels} array. Stored in the returned
 *   {@link SecondaryTileResolution.z} so the consumer knows which COG overview
 *   to fetch.
 * @returns A {@link SecondaryTileResolution} with tile indices, UV transform,
 *   stitched dimensions, and the min col/row of the covered range.
 */
export function resolveSecondaryTiles(
  primaryLevel: TilesetLevel,
  primaryCol: number,
  primaryRow: number,
  secondaryLevel: TilesetLevel,
  secondaryZ: number,
): SecondaryTileResolution {
  // Step 1: Get the CRS extent of the primary tile
  const corners = primaryLevel.projectedTileCorners(primaryCol, primaryRow);
  const primaryMinX = Math.min(
    corners.topLeft[0],
    corners.bottomLeft[0],
    corners.topRight[0],
    corners.bottomRight[0],
  );
  const primaryMaxX = Math.max(
    corners.topLeft[0],
    corners.bottomLeft[0],
    corners.topRight[0],
    corners.bottomRight[0],
  );
  const primaryMinY = Math.min(
    corners.topLeft[1],
    corners.bottomLeft[1],
    corners.topRight[1],
    corners.bottomRight[1],
  );
  const primaryMaxY = Math.max(
    corners.topLeft[1],
    corners.bottomLeft[1],
    corners.topRight[1],
    corners.bottomRight[1],
  );

  // Step 2: Find covering secondary tiles
  const range = secondaryLevel.crsBoundsToTileRange(
    primaryMinX,
    primaryMinY,
    primaryMaxX,
    primaryMaxY,
  );
  const tileIndices: SecondaryTileIndex[] = [];
  for (let row = range.minRow; row <= range.maxRow; row++) {
    for (let col = range.minCol; col <= range.maxCol; col++) {
      tileIndices.push({ x: col, y: row });
    }
  }

  // Step 3: Compute the CRS extent of the stitched secondary region
  const minCorners = secondaryLevel.projectedTileCorners(
    range.minCol,
    range.minRow,
  );
  const maxCorners = secondaryLevel.projectedTileCorners(
    range.maxCol,
    range.maxRow,
  );
  const allCornerPoints = [
    minCorners.topLeft,
    minCorners.topRight,
    minCorners.bottomLeft,
    minCorners.bottomRight,
    maxCorners.topLeft,
    maxCorners.topRight,
    maxCorners.bottomLeft,
    maxCorners.bottomRight,
  ];
  const stitchedMinX = Math.min(...allCornerPoints.map((p) => p[0]));
  const stitchedMaxX = Math.max(...allCornerPoints.map((p) => p[0]));
  const stitchedMinY = Math.min(...allCornerPoints.map((p) => p[1]));
  const stitchedMaxY = Math.max(...allCornerPoints.map((p) => p[1]));

  const stitchedCrsWidth = stitchedMaxX - stitchedMinX;
  const stitchedCrsHeight = stitchedMaxY - stitchedMinY;

  // Step 4: Compute UV transform.
  // offsetX: how far the primary tile's left edge is from the stitched left edge.
  // offsetY: how far the primary tile's top edge is from the stitched top edge.
  //   CRS Y increases upward, but UV Y increases downward, so we use
  //   (stitchedMaxY - primaryMaxY) for the top-edge offset.
  const primaryCrsWidth = primaryMaxX - primaryMinX;
  const primaryCrsHeight = primaryMaxY - primaryMinY;
  const scaleX = stitchedCrsWidth > 0 ? primaryCrsWidth / stitchedCrsWidth : 1;
  const scaleY =
    stitchedCrsHeight > 0 ? primaryCrsHeight / stitchedCrsHeight : 1;
  const offsetX =
    stitchedCrsWidth > 0 ? (primaryMinX - stitchedMinX) / stitchedCrsWidth : 0;
  const offsetY =
    stitchedCrsHeight > 0
      ? (stitchedMaxY - primaryMaxY) / stitchedCrsHeight
      : 0;

  // Step 5: Stitched pixel dimensions
  const numCols = range.maxCol - range.minCol + 1;
  const numRows = range.maxRow - range.minRow + 1;
  const stitchedWidth = numCols * secondaryLevel.tileWidth;
  const stitchedHeight = numRows * secondaryLevel.tileHeight;

  return {
    tileIndices,
    uvTransform: [offsetX, offsetY, scaleX, scaleY],
    stitchedWidth,
    stitchedHeight,
    minCol: range.minCol,
    minRow: range.minRow,
    z: secondaryZ,
  };
}
