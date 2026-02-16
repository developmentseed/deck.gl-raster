/* This file was automatically generated from OGC TMS 2.0 JSON Schema. */
/* DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file */
/* and run `pnpm run generate-types` to regenerate.                     */

/**
 * Variable Matrix Width data structure
 */
export interface VariableMatrixWidth {
  /**
   * Number of tiles in width that coalesce in a single tile for these rows
   */
  coalesce: number;
  /**
   * First tile row where the coalescence factor applies for this tilematrix
   */
  minTileRow: number;
  /**
   * Last tile row where the coalescence factor applies for this tilematrix
   */
  maxTileRow: number;
  [k: string]: unknown;
}
