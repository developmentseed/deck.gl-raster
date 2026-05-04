import type { Bounds, Corners, ProjectionFunction } from "./types.js";

/**
 * A single zoom level in a generic raster tileset.
 *
 * This interface abstracts over both TileMatrixSet levels and Zarr multiscale
 * levels, enabling a single traversal algorithm to work with both.
 */
export interface TilesetLevel {
  /** Number of tiles across this level (columns). */
  matrixWidth: number;

  /** Number of tiles down this level (rows). */
  matrixHeight: number;

  /** Width of each tile in pixels. */
  tileWidth: number;

  /** Height of each tile in pixels. */
  tileHeight: number;

  /**
   * Meters per pixel — used for LOD selection.
   *
   * For TileMatrix: `scaleDenominator * SCREEN_PIXEL_SIZE` (0.00028 m).
   * For Zarr: `sqrt(|scaleX * scaleY|) * mpu` (meters per CRS unit).
   */
  metersPerPixel: number;

  /**
   * Get the projected bounding box of a tile in the source CRS.
   *
   * The tileset is not guaranteed to be axis aligned, so this returns a rotated
   * rectangle as four corners, which preserves rotation/skew information that
   * would be lost in an axis-aligned bbox.
   *
   * For TMS this delegates to `xy_bounds()`; for Zarr it uses affine math
   * directly. Using a function (rather than a stored affine) lets TMS handle
   * variable tile widths (coalesced rows) and bottomLeft origins cleanly.
   */
  projectedTileCorners: (col: number, row: number) => Corners;

  /**
   * Get the range of tile indices that overlap a given CRS bounding box.
   *
   * The returned range is **inclusive** on both ends: a consumer should
   * iterate `for (let col = minCol; col <= maxCol; col++)`.
   *
   * Used by the traversal algorithm to find child tiles from a parent tile's
   * projected bounds.
   */
  crsBoundsToTileRange: (
    projectedMinX: number,
    projectedMinY: number,
    projectedMaxX: number,
    projectedMaxY: number,
  ) => { minCol: number; maxCol: number; minRow: number; maxRow: number };

  /**
   * Get per-tile forward/inverse coordinate transforms for the tile at
   * `(col, row)`.
   *
   * - `forwardTransform(px, py)` maps a pixel coordinate within the tile
   *   (origin at the top-left of the tile, (0,0) at the top-left pixel)
   *   to a coordinate in the source CRS.
   * - `inverseTransform(cx, cy)` is its inverse.
   *
   * For axis-aligned tilesets these are affine; the interface allows
   * non-affine transforms (e.g. GCPs) in the future.
   */
  tileTransform: (
    col: number,
    row: number,
  ) => {
    forwardTransform: ProjectionFunction;
    inverseTransform: ProjectionFunction;
  };
}

/**
 * A full multi-resolution raster tileset descriptor.
 *
 * Index 0 = coarsest level, higher index = finer detail (same ordering as
 * TileMatrixSet).
 */
export interface TilesetDescriptor {
  /** Ordered levels from coarsest (0) to finest. */
  levels: TilesetLevel[];

  /**
   * Projection function from the source CRS → EPSG:3857.
   *
   * Provided by the caller (e.g. COGLayer or ZarrLayer) so that
   * `deck.gl-raster` itself does not need a proj4 dependency.
   */
  projectTo3857: ProjectionFunction;

  /**
   * Projection function from the source CRS → EPSG:4326.
   *
   * Provided by the caller so that `deck.gl-raster` itself does not need a
   * proj4 dependency.
   */
  projectTo4326: ProjectionFunction;

  /**
   * Inverse projection function from EPSG:4326 → source CRS.
   *
   * Provided by the caller alongside `projectTo4326`.
   */
  projectFrom4326: ProjectionFunction;

  /**
   * Inverse projection function from EPSG:3857 → source CRS.
   *
   * Provided by the caller alongside `projectTo3857`.
   */
  projectFrom3857: ProjectionFunction;

  /** Bounding box of the dataset in the source CRS. */
  projectedBounds: Bounds;
}
