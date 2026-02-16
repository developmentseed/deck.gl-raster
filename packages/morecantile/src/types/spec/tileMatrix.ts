/* This file was automatically generated from OGC TMS 2.0 JSON Schema. */
/* DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file */
/* and run `pnpm run generate-types` to regenerate.                     */

import type { DPoint } from "./2DPoint.js";
import type { VariableMatrixWidth } from "./variableMatrixWidth.js";

/**
 * A tile matrix, usually corresponding to a particular zoom level of a TileMatrixSet.
 */
export interface TileMatrix {
  /**
   * Title of this tile matrix, normally used for display to a human
   */
  title?: string;
  /**
   * Brief narrative description of this tile matrix set, normally available for display to a human
   */
  description?: string;
  /**
   * Unordered list of one or more commonly used or formalized word(s) or phrase(s) used to describe this dataset
   */
  keywords?: string[];
  /**
   * Identifier selecting one of the scales defined in the TileMatrixSet and representing the scaleDenominator the tile. Implementation of 'identifier'
   */
  id: string;
  /**
   * Scale denominator of this tile matrix
   */
  scaleDenominator: number;
  /**
   * Cell size of this tile matrix
   */
  cellSize: number;
  /**
   * The corner of the tile matrix (_topLeft_ or _bottomLeft_) used as the origin for numbering tile rows and columns. This corner is also a corner of the (0, 0) tile.
   */
  cornerOfOrigin?: "topLeft" | "bottomLeft";
  pointOfOrigin: DPoint;
  /**
   * Width of each tile of this tile matrix in pixels
   */
  tileWidth: number;
  /**
   * Height of each tile of this tile matrix in pixels
   */
  tileHeight: number;
  /**
   * Width of the matrix (number of tiles in width)
   */
  matrixHeight: number;
  /**
   * Height of the matrix (number of tiles in height)
   */
  matrixWidth: number;
  /**
   * Describes the rows that has variable matrix width
   */
  variableMatrixWidths?: VariableMatrixWidth[];
  [k: string]: unknown;
}
