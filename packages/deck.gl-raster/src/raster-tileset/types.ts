export type ZRange = [minZ: number, maxZ: number];

/** An axis-aligned bounding box */
export type Bounds = [minX: number, minY: number, maxX: number, maxY: number];

/** Corners which may or may not be axis-aligned. */
export type Corners = {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRight: Point;
};

export type GeoBoundingBox = {
  west: number;
  north: number;
  east: number;
  south: number;
};

export type ProjectedBoundingBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** A 2D point represented as [x, y] */
export type Point = [number, number];

/** A function that projects coordinates from one CRS to another */
export type ProjectionFunction = (x: number, y: number) => Point;

/**
 * Bounding box defined by two named corners
 */
export type CornerBounds = {
  lowerLeft: Point;
  upperRight: Point;
};

/**
 * Raster Tile Index
 *
 * In TileMatrixSet ordering: `level === z`.
 *
 * So level `z` is the coarsest resolution (0) and the highest `z` is the finest
 *  resolution.
 */
export type TileIndex = {
  x: number;
  y: number;

  /**
   * TileMatrixSet/OSM zoom (0 = coarsest, higher = finer)
   */
  z: number;
};
