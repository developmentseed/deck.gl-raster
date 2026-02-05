import type { RasterArray } from "./array.js";

/** A single tile fetched from a GeoTIFF or Overview. */
export type Tile = {
  /** Tile column index in the image's tile grid. */
  x: number;
  /** Tile row index in the image's tile grid. */
  y: number;
  /** Decoded raster data for this tile. */
  array: RasterArray;
};
