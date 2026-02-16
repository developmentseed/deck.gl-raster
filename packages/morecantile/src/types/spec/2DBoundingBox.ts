/* This file was automatically generated from OGC TMS 2.0 JSON Schema. */
/* DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file */
/* and run `pnpm run generate-types` to regenerate.                     */

import type { DPoint } from "./2DPoint.js";
import type { CRS } from "./crs.js";

/**
 * Minimum bounding rectangle surrounding a 2D resource in the CRS indicated elsewhere
 */
export interface DBoundingBox {
  lowerLeft: DPoint;
  upperRight: DPoint;
  crs?: CRS;
  /**
   * @minItems 2
   * @maxItems 2
   */
  orderedAxes?: [string, string];
  [k: string]: unknown;
}
