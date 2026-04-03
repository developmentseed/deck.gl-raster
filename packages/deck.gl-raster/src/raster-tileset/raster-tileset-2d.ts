/**
 * TileMatrixSetTileset - Improved Implementation with Frustum Culling
 *
 * This version properly implements frustum culling and bounding volume calculations
 * following the pattern from deck.gl's OSM tile indexing.
 */

import type { Viewport } from "@deck.gl/core";
import type {
  GeoBoundingBox,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import { transformBounds } from "@developmentseed/proj";
import type { Matrix4 } from "@math.gl/core";
import { getTileIndices } from "./raster-tile-traversal";
import type { TilesetDescriptor } from "./tileset-interface";
import { TileMatrixSetAdaptor } from "./tms-interface";
import type {
  Bounds,
  Corners,
  ProjectedBoundingBox,
  ProjectionFunction,
  TileIndex,
  ZRange,
} from "./types";

/** Type returned by `getTileMetadata` */
export type TileMetadata = {
  /**
   * **Axis-aligned** bounding box of the tile in **WGS84 coordinates**.
   */
  bbox: GeoBoundingBox;

  /**
   * **Axis-aligned** bounding box of the tile in **projected coordinates**.
   */
  projectedBbox: ProjectedBoundingBox;

  /**
   * "Rotated" bounding box of the tile in **projected coordinates**,
   * represented as four corners.
   *
   * This preserves rotation/skew information that would be lost in the
   * axis-aligned bbox.
   */
  projectedCorners: Corners;

  /**
   * Tile width in pixels.
   *
   * Note this may differ between levels in some TileMatrixSets.
   */
  tileWidth: number;

  /**
   * Tile height in pixels.
   *
   * Note this may differ between levels in some TileMatrixSets.
   */
  tileHeight: number;
};

/**
 * A generic tileset implementation organized according to the OGC
 * [TileMatrixSet](https://docs.ogc.org/is/17-083r4/17-083r4.html)
 * specification.
 *
 * Handles tile lifecycle, caching, and viewport-based loading.
 */
export class TileMatrixSetTileset extends Tileset2D {
  private tms: TileMatrixSet;
  private wgs84Bounds: Bounds;
  private projectTo4326: ProjectionFunction;
  private tilesetDescriptor: TilesetDescriptor;

  constructor(
    opts: Tileset2DProps,
    tms: TileMatrixSet,
    {
      projectTo4326,
      projectTo3857,
    }: {
      projectTo4326: ProjectionFunction;
      projectTo3857: ProjectionFunction;
    },
  ) {
    super(opts);
    this.tms = tms;
    this.projectTo4326 = projectTo4326;

    if (!tms.boundingBox) {
      throw new Error(
        "Bounding Box inference not yet implemented; should be provided on TileMatrixSet",
      );
    }

    this.tilesetDescriptor = new TileMatrixSetAdaptor(tms, {
      projectTo3857,
      projectTo4326,
    });

    this.wgs84Bounds = transformBounds(
      projectTo4326,
      ...this.tilesetDescriptor.projectedBounds,
    );
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
    const maxAvailableZ = this.tms.tileMatrices.length - 1;

    const maxZ =
      typeof opts.maxZoom === "number"
        ? Math.min(opts.maxZoom, maxAvailableZ)
        : maxAvailableZ;

    const tileIndices = getTileIndices(this.tilesetDescriptor, {
      viewport: opts.viewport,
      maxZ,
      zRange: opts.zRange ?? null,
      wgs84Bounds: this.wgs84Bounds,
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

    const currentOverview = this.tms.tileMatrices[index.z]!;
    const parentOverview = this.tms.tileMatrices[index.z - 1]!;

    // Decimation is the number of child tiles that fit across one parent tile.
    // Must use tile footprint (cellSize × tileWidth/Height), not cellSize alone,
    // because tileWidth can change between levels (e.g. the last Sentinel-2
    // overview doubles tileWidth while halving cellSize, giving a 1:1 spatial
    // mapping where decimation = 1).
    const parentFootprintX = parentOverview.cellSize * parentOverview.tileWidth;
    const parentFootprintY =
      parentOverview.cellSize * parentOverview.tileHeight;
    const currentFootprintX =
      currentOverview.cellSize * currentOverview.tileWidth;
    const currentFootprintY =
      currentOverview.cellSize * currentOverview.tileHeight;

    const decimationX = parentFootprintX / currentFootprintX;
    const decimationY = parentFootprintY / currentFootprintY;

    return {
      x: Math.floor(index.x / decimationX),
      y: Math.floor(index.y / decimationY),
      z: index.z - 1,
    };
  }

  override getTileZoom(index: TileIndex): number {
    return index.z;
  }

  override getTileMetadata(index: TileIndex): TileMetadata {
    const { x, y, z } = index;
    const levelDescriptor = this.tilesetDescriptor.levels[z]!;
    const { tileHeight, tileWidth } = levelDescriptor;
    const { topLeft, topRight, bottomLeft, bottomRight } =
      levelDescriptor.projectedTileCorners(x, y);

    // Return the projected bounds as four corners
    // This preserves rotation/skew information
    const projectedCorners = {
      topLeft,
      topRight,
      bottomLeft,
      bottomRight,
    };

    // Also compute axis-aligned bounding box for compatibility
    const projectedBounds: Bounds = [
      Math.min(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
      Math.min(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1]),
      Math.max(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
      Math.max(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1]),
    ];

    // deck.gl's Tile2DHeader uses `bbox` (GeoBoundingBox) for screen-space
    // culling in filterSubLayer → isTileVisible. Without this, all tiles
    // would pass (or fail) the cull-rect test and the refinementStrategy
    // (best-available) would not show parent tiles correctly.
    const [west, south, east, north] = transformBounds(
      this.projectTo4326,
      ...projectedBounds,
    );

    return {
      bbox: {
        west,
        south,
        east,
        north,
      },
      projectedBbox: {
        left: projectedBounds[0],
        bottom: projectedBounds[1],
        right: projectedBounds[2],
        top: projectedBounds[3],
      },
      projectedCorners,
      tileWidth,
      tileHeight,
    };
  }
}
