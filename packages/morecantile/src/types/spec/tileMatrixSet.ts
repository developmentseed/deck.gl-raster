/* This file was automatically generated from OGC TMS 2.0 JSON Schema. */
/* DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file */
/* and run `pnpm run generate-types` to regenerate.                     */

import type { DBoundingBox } from "./2DBoundingBox.js";
import type { CRS } from "./crs.js";
import type { TileMatrix } from "./tileMatrix.js";

/**
 * A definition of a tile matrix set following the Tile Matrix Set standard. For tileset metadata, such a description (in `tileMatrixSet` property) is only required for offline use, as an alternative to a link with a `http://www.opengis.net/def/rel/ogc/1.0/tiling-scheme` relation type.
 */
export interface TileMatrixSetDefinition {
  /**
   * Title of this tile matrix set, normally used for display to a human
   */
  title?: string;
  /**
   * Brief narrative description of this tile matrix set, normally available for display to a human
   */
  description?: string;
  /**
   * Unordered list of one or more commonly used or formalized word(s) or phrase(s) used to describe this tile matrix set
   */
  keywords?: string[];
  /**
   * Tile matrix set identifier. Implementation of 'identifier'
   */
  id?: string;
  /**
   * Reference to an official source for this tileMatrixSet
   */
  uri?: string;
  /**
   * @minItems 1
   */
  orderedAxes?: [string, ...string[]];
  crs: CRS;
  /**
   * Reference to a well-known scale set
   */
  wellKnownScaleSet?: string;
  boundingBox?: DBoundingBox;
  /**
   * Describes scale levels and its tile matrices
   */
  tileMatrices: TileMatrix[];
  [k: string]: unknown;
}
