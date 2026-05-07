/**
 * RasterTileset2D - Generic tile traversal over a tile pyramid with Frustum
 * Culling
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
import { transformBounds } from "@developmentseed/proj";
import type { Matrix4 } from "@math.gl/core";
import { getTileIndices } from "./raster-tile-traversal.js";
import type { TilesetDescriptor } from "./tileset-interface.js";
import type {
  Bounds,
  Corners,
  ProjectedBoundingBox,
  TileIndex,
  ZRange,
} from "./types.js";

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
   */
  tileWidth: number;

  /**
   * Tile height in pixels.
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
/**
 * Optional configuration for a {@link RasterTileset2D}.
 */
export interface RasterTileset2DOptions {
  /**
   * Returns the current device-pixels-per-CSS-pixel ratio. Read at every
   * `getTileIndices` call so that runtime changes (e.g. dragging the
   * window between displays of different DPR) take effect on the next
   * tile evaluation. Defaults to a constant `1` if omitted, which makes
   * LOD selection CSS-pixel-accurate but blurry on HiDPI displays. The
   * `RasterTileLayer` wires this to `device.canvasContext.cssToDeviceRatio()`.
   * See `dev-docs/lod-and-pixel-matching.md` § (A).
   */
  getPixelRatio?: () => number;
}

export class RasterTileset2D extends Tileset2D {
  private descriptor: TilesetDescriptor;
  private wgs84Bounds: Bounds;
  private getPixelRatio: () => number;

  constructor(
    opts: Tileset2DProps,
    descriptor: TilesetDescriptor,
    { getPixelRatio }: RasterTileset2DOptions = {},
  ) {
    super(opts);
    this.descriptor = descriptor;
    this.getPixelRatio = getPixelRatio ?? (() => 1);

    const rawBounds = transformBounds(
      this.descriptor.projectTo4326,
      ...this.descriptor.projectedBounds,
    );
    // Web Mercator cannot represent latitudes outside ~±85.051°, and the
    // downstream tile traversal calls `lngLatToWorld` on these bounds which
    // asserts against that range. Global data at ±90° (e.g. reanalysis grids)
    // would otherwise crash tile selection. Clamp here; any polar rows beyond
    // ±MAX_LAT are unreachable on a Mercator map anyway.
    const MAX_LAT = 85.0511287798066;
    this.wgs84Bounds = [
      rawBounds[0],
      Math.max(rawBounds[1], -MAX_LAT),
      rawBounds[2],
      Math.min(rawBounds[3], MAX_LAT),
    ];
  }

  /**
   * Get tile indices visible in viewport
   * Uses frustum culling similar to OSM implementation
   *
   * Overviews follow TileMatrixSet ordering: index 0 = coarsest, higher = finer
   *
   * `minZoom` and `maxZoom` gate against `viewport.zoom` (not the tileset
   * z-index, which is an overview level in our descriptor). When the
   * viewport zoom is outside these bounds this method returns an empty
   * list — no new tile fetches, and because deck.gl's `updateTileStates`
   * marks unselected cached tiles invisible, no rendering either.
   * `visibleMinZoom` / `visibleMaxZoom` (deck.gl 9.3+) are deliberately
   * not honored: their documented "fetch but don't render" semantic
   * requires a notion of clamping to a coarser z, which doesn't
   * generalize to descriptors with sparse or single overviews. See
   * `dev-docs/zoom-terminology.md` for the rationale.
   */
  override getTileIndices(opts: {
    viewport: Viewport;
    maxZoom?: number;
    minZoom?: number;
    zRange: ZRange | null;
    modelMatrix?: Matrix4;
    modelMatrixInverse?: Matrix4;
  }): TileIndex[] {
    const { viewport, minZoom } = opts;

    if (typeof minZoom === "number" && viewport.zoom < minZoom) {
      return [];
    }

    const maxAvailableZ = this.descriptor.levels.length - 1;
    const maxZ =
      typeof opts.maxZoom === "number"
        ? Math.min(opts.maxZoom, maxAvailableZ)
        : maxAvailableZ;

    const tileIndices = getTileIndices(this.descriptor, {
      viewport,
      maxZ,
      zRange: opts.zRange ?? null,
      wgs84Bounds: this.wgs84Bounds,
      pixelRatio: this.getPixelRatio(),
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

    const currentOverview = this.descriptor.levels[index.z]!;
    const parentOverview = this.descriptor.levels[index.z - 1]!;

    // Decimation is the number of child tiles that fit across one parent tile.
    // Must use tile footprint (cellSize × tileWidth/Height), not cellSize alone,
    // because tileWidth can change between levels (e.g. the last Sentinel-2
    // overview doubles tileWidth while halving cellSize, giving a 1:1 spatial
    // mapping where decimation = 1).
    const parentFootprintX =
      parentOverview.metersPerPixel * parentOverview.tileWidth;
    const parentFootprintY =
      parentOverview.metersPerPixel * parentOverview.tileHeight;
    const currentFootprintX =
      currentOverview.metersPerPixel * currentOverview.tileWidth;
    const currentFootprintY =
      currentOverview.metersPerPixel * currentOverview.tileHeight;

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
    const levelDescriptor = this.descriptor.levels[z]!;
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
      this.descriptor.projectTo4326,
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
