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

/** Interface for objects that are tiled and can provide tile dimensions. */
interface IsTiled {
  /** The width of tiles in pixels. */
  readonly tileWidth: number;

  /** The height of tiles in pixels. */
  readonly tileHeight: number;

  /** The height of the image in pixels. */
  readonly height: number;

  /** The width of the image in pixels. */
  readonly width: number;
}

/** The number of tiles in the x and y directions */
export function tileCount(self: IsTiled): [number, number] {
  return [
    Math.ceil(self.width / self.tileWidth),
    Math.ceil(self.height / self.tileHeight),
  ];
}
