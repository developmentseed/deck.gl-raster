import type { RasterTilesetDescriptor } from "./raster-tileset/index.js";

/**
 * Bounds in WGS84 degrees.
 *
 * Data across the antimeridian is bounded the short way, so `east` can be past
 * 180.
 */
export type GeographicBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * Opened raster data that layers draw.
 *
 * A subclass per format opens its data in an async factory, such as
 * `COGSource.open`. A layer given a source derives everything from it without
 * loading anything, and several layers can share one source.
 */
export abstract class RasterSource {
  /** The tile grid: each level's tiles and the functions that project them. */
  readonly tilesetDescriptor: RasterTilesetDescriptor;

  /** Bounds of the data in WGS84 degrees. */
  readonly geographicBounds: GeographicBounds;

  /** Called by a subclass's factory, such as `COGSource.open`. */
  protected constructor(options: {
    tilesetDescriptor: RasterTilesetDescriptor;
    geographicBounds: GeographicBounds;
  }) {
    this.tilesetDescriptor = options.tilesetDescriptor;
    this.geographicBounds = options.geographicBounds;
  }
}
