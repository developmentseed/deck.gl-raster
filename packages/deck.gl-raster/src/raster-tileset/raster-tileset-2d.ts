/**
 * RasterTileset2D - Improved Implementation with Frustum Culling
 *
 * This version properly implements frustum culling and bounding volume calculations
 * following the pattern from deck.gl's OSM tile indexing.
 */

import type { Viewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import type { Matrix4 } from "@math.gl/core";

import { getTileIndices } from "./raster-tile-traversal";
import type {
  Bounds,
  CornerBounds,
  Point,
  ProjectionFunction,
  TileIndex,
  ZRange,
} from "./types";

/**
 * RasterTileset2D with proper frustum culling
 */
export class RasterTileset2D extends Tileset2D {
  private metadata: TileMatrixSet;
  private wgs84Bounds: CornerBounds;
  private projectToWgs84: ProjectionFunction;
  private projectTo3857: ProjectionFunction;

  constructor(
    opts: Tileset2DProps,
    metadata: TileMatrixSet,
    {
      projectToWgs84,
      projectTo3857,
    }: {
      projectToWgs84: ProjectionFunction;
      projectTo3857: ProjectionFunction;
    },
  ) {
    super(opts);
    this.metadata = metadata;
    this.projectToWgs84 = projectToWgs84;
    this.projectTo3857 = projectTo3857;

    this.wgs84Bounds =
      metadata.wgsBounds ||
      projectBoundsToWgs84(metadata.boundingBox, projectToWgs84, {
        densifyPts: 10,
      });
  }

  /**
   * Get tile indices visible in viewport
   * Uses frustum culling similar to OSM implementation
   *
   * Overviews follow TileMatrixSet ordering: index 0 = coarsest, higher = finer
   */
  override getTileIndices(opts: {
    viewport: Viewport;
    maxZoom?: number;
    minZoom?: number;
    zRange: ZRange | null;
    modelMatrix?: Matrix4;
    modelMatrixInverse?: Matrix4;
  }): TileIndex[] {
    const maxAvailableZ = this.metadata.tileMatrices.length - 1;

    const maxZ =
      typeof opts.maxZoom === "number"
        ? Math.min(opts.maxZoom, maxAvailableZ)
        : maxAvailableZ;

    const tileIndices = getTileIndices(this.metadata, {
      viewport: opts.viewport,
      maxZ,
      zRange: opts.zRange ?? null,
      wgs84Bounds: this.wgs84Bounds,
      projectTo3857: this.projectTo3857,
    });

    return tileIndices;
  }

  override getTileId(index: TileIndex): string {
    return `${index.x}-${index.y}-${index.z}`;
  }

  override getParentIndex(index: TileIndex): TileIndex {
    if (index.z === 0) {
      // Already at coarsest level
      return index;
    }

    const currentOverview = this.metadata.tileMatrices[index.z]!;
    const parentOverview = this.metadata.tileMatrices[index.z - 1]!;

    const decimation = currentOverview.cellSize / parentOverview.cellSize;

    return {
      x: Math.floor(index.x / decimation),
      y: Math.floor(index.y / decimation),
      z: index.z - 1,
    };
  }

  override getTileZoom(index: TileIndex): number {
    return index.z;
  }

  override getTileMetadata(index: TileIndex): Record<string, unknown> {
    const { x, y, z } = index;
    const { tileMatrices } = this.metadata;
    const tileMatrix = tileMatrices[z]!;
    const { geotransform, tileHeight, tileWidth } = tileMatrix;

    // Use geotransform to calculate tile bounds
    // geotransform: [a, b, c, d, e, f] where:
    // x_geo = a * col + b * row + c
    // y_geo = d * col + e * row + f
    const [a, b, c, d, e, f] = geotransform;

    // Calculate pixel coordinates for this tile's extent
    const pixelMinCol = x * tileWidth;
    const pixelMinRow = y * tileHeight;
    const pixelMaxCol = (x + 1) * tileWidth;
    const pixelMaxRow = (y + 1) * tileHeight;

    // Calculate the four corners of the tile in geographic coordinates
    const topLeft: [number, number] = [
      a * pixelMinCol + b * pixelMinRow + c,
      d * pixelMinCol + e * pixelMinRow + f,
    ];
    const topRight: [number, number] = [
      a * pixelMaxCol + b * pixelMinRow + c,
      d * pixelMaxCol + e * pixelMinRow + f,
    ];
    const bottomLeft: [number, number] = [
      a * pixelMinCol + b * pixelMaxRow + c,
      d * pixelMinCol + e * pixelMaxRow + f,
    ];
    const bottomRight: [number, number] = [
      a * pixelMaxCol + b * pixelMaxRow + c,
      d * pixelMaxCol + e * pixelMaxRow + f,
    ];

    // Return the projected bounds as four corners
    // This preserves rotation/skew information
    const projectedBounds = {
      topLeft,
      topRight,
      bottomLeft,
      bottomRight,
    };

    // Also compute axis-aligned bounding box for compatibility
    const bounds: Bounds = [
      Math.min(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
      Math.min(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1]),
      Math.max(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
      Math.max(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1]),
    ];

    return {
      bounds,
      projectedBounds,
      tileWidth,
      tileHeight,
      tileMatrix,
    };
  }
}

function projectBoundsToWgs84(
  bounds: CornerBounds,
  projectToWgs84: ProjectionFunction,
  { densifyPts }: { densifyPts: number },
): CornerBounds {
  const { lowerLeft, upperRight } = bounds;

  // Four corners of the bounding box
  const corners: Point[] = [
    lowerLeft,
    [upperRight[0], lowerLeft[1]],
    upperRight,
    [lowerLeft[0], upperRight[1]],
  ];

  // Densify edges: interpolate densifyPts points along each edge
  const points: Point[] = [];
  for (let i = 0; i < corners.length; i++) {
    const from = corners[i]!;
    const to = corners[(i + 1) % corners.length]!;
    // Include the start corner and all intermediate points (end corner
    // will be included as the start of the next edge)
    for (let j = 0; j <= densifyPts; j++) {
      const t = j / (densifyPts + 1);
      points.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
      ]);
    }
  }

  // Reproject all points to WGS84 and compute the bounding box
  let wgsMinX = Infinity;
  let wgsMinY = Infinity;
  let wgsMaxX = -Infinity;
  let wgsMaxY = -Infinity;

  for (const pt of points) {
    const [lon, lat] = projectToWgs84(pt);
    if (lon < wgsMinX) wgsMinX = lon;
    if (lat < wgsMinY) wgsMinY = lat;
    if (lon > wgsMaxX) wgsMaxX = lon;
    if (lat > wgsMaxY) wgsMaxY = lat;
  }

  return {
    lowerLeft: [wgsMinX, wgsMinY],
    upperRight: [wgsMaxX, wgsMaxY],
  };
}
