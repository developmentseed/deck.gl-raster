import type { RasterSource } from "@developmentseed/deck.gl-raster";
import { tileKey } from "./get-tile-data.js";

/** A pixel in the source's finest tile grid. */
export type PixelLocation = {
  /** Key of the tile that holds the pixel, as in {@link tileKey}. */
  key: string;
  /** Row of the pixel within the tile. */
  row: number;
  /** Column of the pixel within the tile. */
  col: number;
};

/**
 * Find the tile and pixel under a WGS84 position, in the finest level of the
 * source's tile grid, or `null` outside the grid.
 */
export function locatePixel(
  source: RasterSource,
  longitude: number,
  latitude: number,
): PixelLocation | null {
  const { levels, projectFrom4326 } = source.tilesetDescriptor;
  // Levels are coarsest first
  const z = levels.length - 1;
  const level = levels[z]!;
  const [x, y] = projectFrom4326(longitude, latitude);
  // The tile grid is affine, so tile (0, 0)'s inverse transform gives pixel
  // coordinates in the whole level
  const [px, py] = level.tileTransform(0, 0).inverseTransform(x, y);
  const tileX = Math.floor(px / level.tileWidth);
  const tileY = Math.floor(py / level.tileHeight);
  if (
    tileX < 0 ||
    tileY < 0 ||
    tileX >= level.matrixWidth ||
    tileY >= level.matrixHeight
  ) {
    return null;
  }
  return {
    key: tileKey(z, tileX, tileY),
    row: Math.floor(py) - tileY * level.tileHeight,
    col: Math.floor(px) - tileX * level.tileWidth,
  };
}
