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

// /**
//  * Represents a single resolution level in a raster tileset.
//  *
//  * COGs contain multiple resolution levels (overviews) for efficient
//  * visualization at different zoom levels.
//  *
//  * IMPORTANT: Overviews are ordered according to TileMatrixSet specification:
//  * - Index 0: Coarsest resolution (most zoomed out)
//  * - Index N: Finest resolution (most zoomed in)
//  *
//  * This matches the natural ordering where z increases with detail.
//  */
// export type TileMatrix = {
//   /**
//    * Unique identifier for this tile matrix.
//    *
//    * The ID is typically a string representation of the overview level,
//    * where lower values correspond to coarser resolutions.
//    */
//   id: string;

//   /**
//    * Scale denominator of this tile matrix.
//    *
//    * Defined as cellSize (meters per pixel) * meters per unit / 0.00028
//    */
//   scaleDenominator: number;

//   /**
//    * Cell size of this tile matrix.
//    *
//    * CRS units per pixel (not necessarily meters).
//    */
//   cellSize: number;

//   /**
//    * Indicates which corner of the tile matrix is the origin.
//    *
//    * Typically "upperLeft" for most raster datasets.
//    */
//   cornerOfOrigin: "lowerLeft" | "upperLeft";

//   /**
//    * Point of origin of this tile matrix in CRS coordinates.
//    */
//   pointOfOrigin: Point;

//   /**
//    * Width of each tile of this tile matrix in pixels.
//    */
//   tileWidth: number;

//   /**
//    * Height of each tile of this tile matrix in pixels.
//    */
//   tileHeight: number;

//   /**
//    * Number of tiles in the X (horizontal) direction at this overview level.
//    *
//    * Calculated as: Math.ceil(width / tileWidth)
//    *
//    * @example
//    * // If tileWidth = 512:
//    * tilesX: 3   // z=0: ceil(1250 / 512)
//    * tilesX: 5   // z=1: ceil(2500 / 512)
//    * tilesX: 10  // z=2: ceil(5000 / 512)
//    * tilesX: 20  // z=3: ceil(10000 / 512)
//    */
//   matrixWidth: number;

//   /**
//    * Number of tiles in the Y (vertical) direction at this overview level.
//    *
//    * Calculated as: Math.ceil(height / tileHeight)
//    *
//    * @example
//    * // If tileHeight = 512:
//    * tilesY: 2   // z=0: ceil(1000 / 512)
//    * tilesY: 4   // z=1: ceil(2000 / 512)
//    * tilesY: 8   // z=2: ceil(4000 / 512)
//    * tilesY: 16  // z=3: ceil(8000 / 512)
//    */
//   matrixHeight: number;

//   /**
//    * Affine geotransform for this overview level.
//    *
//    * Uses Python `affine` package ordering (NOT GDAL ordering):
//    * [a, b, c, d, e, f] where:
//    * - x_geo = a * col + b * row + c
//    * - y_geo = d * col + e * row + f
//    *
//    * Parameters:
//    * - a: pixel width (x resolution)
//    * - b: row rotation (typically 0)
//    * - c: x-coordinate of upper-left corner of the upper-left pixel
//    * - d: column rotation (typically 0)
//    * - e: pixel height (y resolution, typically negative)
//    * - f: y-coordinate of upper-left corner of the upper-left pixel
//    *
//    * @example
//    * // For a UTM image with 30m pixels:
//    * [30, 0, 440720, 0, -30, 3751320]
//    * // x_geo = 30 * col + 440720
//    * // y_geo = -30 * row + 3751320
//    */
//   geotransform: [number, number, number, number, number, number];
// };

// /**
//  * COG Metadata extracted from GeoTIFF
//  */
// export type TileMatrixSet = {
//   /**
//    * Title of this tile matrix set, normally used for display to a human
//    */
//   title?: string;

//   /**
//    * Brief narrative description of this tile matrix set, normally available for display to a human
//    */
//   description?: string;

//   /**
//    * Coordinate Reference System of this tile matrix set.
//    */
//   crs: CRS;

//   /**
//    * Bounding box of this TMS.
//    *
//    * The TileMatrixSetBoundingBox can contain its own CRS, which may differ
//    * from the overall TileMatrixSet CRS.
//    */
//   boundingBox?: TileMatrixSetBoundingBox;

//   /**
//    * Describes scale levels and its tile matrices
//    */
//   tileMatrices: TileMatrix[];

//   /**
//    * Bounding box of this TMS in WGS84 lon/lat.
//    */
//   wgsBounds?: TileMatrixSetBoundingBox;
// };

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
