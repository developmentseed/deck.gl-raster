import type { TileMatrix, TileMatrixSet } from "@developmentseed/morecantile";
import { xy_bounds } from "@developmentseed/morecantile";
import type { TilesetDescriptor, TilesetLevel } from "./tileset-interface";
import type { Bounds, Point, ProjectionFunction } from "./types";

// 0.28 mm per pixel — OGC TMS 2.0 standard screen pixel size
// https://docs.ogc.org/is/17-083r4/17-083r4.html#toc15
const SCREEN_PIXEL_SIZE = 0.00028;

class TileMatrixAdaptor implements TilesetLevel {
  inner: TileMatrix;

  constructor(tileMatrix: TileMatrix) {
    this.inner = tileMatrix;
  }

  get matrixWidth() {
    return this.inner.matrixWidth;
  }

  get matrixHeight() {
    return this.inner.matrixHeight;
  }

  get tileWidth() {
    return this.inner.tileWidth;
  }

  get tileHeight() {
    return this.inner.tileHeight;
  }

  get metersPerPixel() {
    return this.inner.scaleDenominator * SCREEN_PIXEL_SIZE;
  }

  /**
   * Compute the projected tile bounds in the tile matrix's CRS.
   *
   * Because it's a linear transformation from the tile index to projected bounds,
   * we don't need to sample this for each of the reference points. We only need
   * the corners.
   *
   * @return      The bounding box as [minX, minY, maxX, maxY] in projected CRS.
   */
  projectedTileBounds(
    col: number,
    row: number,
  ): {
    topLeft: Point;
    topRight: Point;
    bottomLeft: Point;
    bottomRight: Point;
  } {
    const bounds = xy_bounds(this.inner, { x: col, y: row });
    return {
      topLeft: [bounds.lowerLeft[0], bounds.upperRight[1]],
      topRight: bounds.upperRight,
      bottomLeft: bounds.lowerLeft,
      bottomRight: [bounds.upperRight[0], bounds.lowerLeft[1]],
    };
  }

  /**
   * Compute the range of tile indices in a child TileMatrix that spatially
   * overlap a parent tile
   *
   * TileMatrixSets are not guaranteed to form a strict quadtree: successive
   * TileMatrix levels may differ by non-integer refinement ratios and may not
   * align perfectly in tile space. As a result, parent/child relationships
   * cannot be inferred from zoom level or resolution alone.
   *
   * This function determines parent→child relationships by:
   * 1. Treating each TileMatrix as an independent, axis-aligned grid in CRS space
   * 2. Mapping the parent tile's CRS bounding box into the child grid
   * 3. Returning the inclusive range of child tile indices whose spatial extent
   *    intersects the parent tile
   *
   * The returned indices are clamped to the valid extents of the child matrix
   * (`[0, matrixWidth)` and `[0, matrixHeight)`).
   *
   * Assumptions:
   * - The TileMatrix grid is axis-aligned in CRS space
   * - `cornerOfOrigin` is `"topLeft"`
   * - Tiles are rectangular and uniformly sized within a TileMatrix
   *
   * @param parentBounds  Bounding box of the parent tile in CRS coordinates
   *                      as `[minX, minY, maxX, maxY]`
   * @param childMatrix   The TileMatrix definition for the child zoom level
   *
   * @returns An object containing inclusive index ranges:
   *          `{ minCol, maxCol, minRow, maxRow }`, identifying all child tiles
   *          that spatially overlap the parent tile
   */
  crsBoundsToTileRange(
    projectedMinX: number,
    projectedMinY: number,
    projectedMaxX: number,
    projectedMaxY: number,
  ): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
    const {
      tileWidth,
      tileHeight,
      cellSize,
      matrixWidth,
      matrixHeight,
      pointOfOrigin,
    } = this.inner;

    const childTileWidthCRS = tileWidth * cellSize;
    const childTileHeightCRS = tileHeight * cellSize;

    // Note: we assume top left origin
    const originX = pointOfOrigin[0];
    const originY = pointOfOrigin[1];

    // Convert CRS bounds → tile indices
    let minCol = Math.floor((projectedMinX - originX) / childTileWidthCRS);
    let maxCol = Math.floor((projectedMaxX - originX) / childTileWidthCRS);

    let minRow = Math.floor((originY - projectedMaxY) / childTileHeightCRS);
    let maxRow = Math.floor((originY - projectedMinY) / childTileHeightCRS);

    // Clamp to matrix bounds
    minCol = Math.max(0, Math.min(matrixWidth - 1, minCol));
    maxCol = Math.max(0, Math.min(matrixWidth - 1, maxCol));
    minRow = Math.max(0, Math.min(matrixHeight - 1, minRow));
    maxRow = Math.max(0, Math.min(matrixHeight - 1, maxRow));

    return { minCol, maxCol, minRow, maxRow };
  }
}

export class TileMatrixSetAdaptor implements TilesetDescriptor {
  tms: TileMatrixSet;
  private _levels: TileMatrixAdaptor[];
  projectTo3857: ProjectionFunction;
  projectTo4326: ProjectionFunction;

  constructor(
    tms: TileMatrixSet,
    {
      projectTo3857,
      projectTo4326,
    }: { projectTo3857: ProjectionFunction; projectTo4326: ProjectionFunction },
  ) {
    this.tms = tms;
    this._levels = tms.tileMatrices.map((tm) => new TileMatrixAdaptor(tm));
    this.projectTo3857 = projectTo3857;
    this.projectTo4326 = projectTo4326;
  }

  get levels(): TilesetLevel[] {
    return this._levels;
  }

  get projectedBounds(): Bounds {
    const { boundingBox } = this.tms;
    if (!boundingBox) {
      throw new Error(
        "Bounding Box inference not yet implemented; should be provided on TileMatrixSet",
      );
    }

    const { lowerLeft, upperRight } = boundingBox;
    return [lowerLeft[0], lowerLeft[1], upperRight[0], upperRight[1]];
  }
}
