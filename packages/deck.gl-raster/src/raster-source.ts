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

  constructor(options: {
    tilesetDescriptor: RasterTilesetDescriptor;
    geographicBounds: GeographicBounds;
  }) {
    this.tilesetDescriptor = options.tilesetDescriptor;
    this.geographicBounds = options.geographicBounds;
  }
}

/**
 * Props of a layer that draws a {@link RasterSource}.
 */
export type RasterSourceLayerProps<SourceT extends RasterSource> = {
  /**
   * An opened source to draw.
   *
   * The layer derives everything from it without loading anything, and several
   * layers can share one source. Keep the same object across renders: a new
   * source starts the layer's tiles over.
   *
   * Takes precedence over the layer's shorthand props, such as COGLayer's
   * `geotiff`.
   */
  source?: SourceT;

  /**
   * Called with the source the layer opened from its shorthand props, such as
   * COGLayer's `geotiff`.
   *
   * Not called for a `source` prop, which the app opened itself.
   */
  onSourceLoad?: (source: SourceT) => void;
};
