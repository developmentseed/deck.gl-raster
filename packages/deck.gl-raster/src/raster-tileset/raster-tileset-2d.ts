/**
 * RasterTileset2D - Improved Implementation with Frustum Culling
 *
 * This version properly implements frustum culling and bounding volume calculations
 * following the pattern from deck.gl's OSM tile indexing.
 */

import { Viewport } from "@deck.gl/core";
import { _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
import { Matrix4 } from "@math.gl/core";

import { getTileIndices } from "./raster-tile-traversal";
import type { TileIndex, Bounds, TileMatrixSet, ZRange } from "./types";

// Include correct Tileset2DProps type when exported from deck.gl
// https://github.com/visgl/deck.gl/pull/9917
type Tileset2DProps = any;

/**
 * RasterTileset2D with proper frustum culling
 */
export class RasterTileset2D extends Tileset2D {
  private metadata: TileMatrixSet;

  constructor(metadata: TileMatrixSet, opts: Tileset2DProps) {
    super(opts);
    this.metadata = metadata;
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
    console.log("Called getTileIndices", opts);
    const tileIndices = getTileIndices(this.metadata, opts);
    console.log("Visible tile indices:", tileIndices);

    // return [
    //   { x: 0, y: 0, z: 0 },
    //   { x: 0, y: 0, z: 1 },
    //   { x: 1, y: 1, z: 2 },
    //   { x: 1, y: 2, z: 3 },
    //   { x: 2, y: 1, z: 3 },
    //   { x: 2, y: 2, z: 3 },
    //   { x: 3, y: 1, z: 3 },
    // ]; // Temporary override for testing
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
