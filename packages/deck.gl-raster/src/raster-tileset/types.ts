export type ZRange = [minZ: number, maxZ: number];

export type Bounds = [minX: number, minY: number, maxX: number, maxY: number];

export type GeoBoundingBox = {
  west: number;
  north: number;
  east: number;
  south: number;
};
export type NonGeoBoundingBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type TileBoundingBox = NonGeoBoundingBox | GeoBoundingBox;

export type TileLoadProps = {
  index: TileIndex;
  id: string;
  bbox: TileBoundingBox;
  url?: string | null;
  signal?: AbortSignal;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userData?: Record<string, any>;
  zoom?: number;
};

export type Point = [number, number];

type CRS = any;

export type ProjectionFunction = (x: number, y: number) => Point;

/**
 * Bounding box defined by two named corners
 */
export type CornerBounds = {
  lowerLeft: Point;
  upperRight: Point;
};

/**
 * Minimum bounding rectangle surrounding a 2D resource in the CRS indicated elsewhere
 */
export type TileMatrixSetBoundingBox = CornerBounds & {
  crs?: CRS;
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
