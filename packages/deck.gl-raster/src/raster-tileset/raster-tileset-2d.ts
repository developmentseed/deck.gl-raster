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
import { BoundingVolumeCache } from "./bounding-volume-cache.js";
import { getTileIndices } from "./raster-tile-traversal.js";
import { sortByDistanceFromPoint } from "./sort-by-distance.js";
import type { RasterTilesetDescriptor } from "./tileset-interface.js";
import type {
  Bounds,
  Corners,
  ProjectedBoundingBox,
  ProjectionFunction,
  TileIndex,
  ZRange,
} from "./types.js";

/** Type returned by {@link RasterTileset2D.getTileMetadata} */
export type RasterTileMetadata = {
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

  /**
   * Forward (tile-local pixel → CRS) transform for this tile.
   *
   * Stable across the tile's lifetime; computed once at tile creation. Stored
   * on the tile so downstream layers (e.g. `RasterTileLayer._renderSubLayers`)
   * receive a reference-stable function across renders, which is what
   * `RasterLayer`'s `reprojectionFnsChanged` check needs to avoid spurious mesh
   * regeneration.
   */
  forwardTransform: ProjectionFunction;

  /**
   * Inverse (CRS → tile-local pixel) transform.
   *
   * Same stability guarantees as {@link TileMetadata.forwardTransform}.
   */
  inverseTransform: ProjectionFunction;
};

/**
 * Configuration for a {@link RasterTileset2D}.
 */
export interface RasterTileset2DOptions {
  /**
   * Returns the current drawing-buffer-pixel/CSS-pixel ratio.
   *
   * Read at every `getTileIndices` call so that runtime changes (e.g. dragging
   * the window between displays of different DPR, or toggling
   * `Deck.useDevicePixels`) take effect on the next tile evaluation.
   *
   * Defaults to a constant `1` if omitted, which makes LOD selection
   * CSS-pixel-accurate but blurry on HiDPI displays. The `RasterTileLayer`
   * wires this to `drawingBufferWidth / cssWidth` read from the layer's
   * canvas context per call. See `dev-docs/lod-and-pixel-matching.md` § (A).
   */
  getPixelRatio?: () => number;

  /**
   * Soft cap on the number of tile bounding volumes cached across
   * `getTileIndices` calls. Bounding volumes are expensive to compute (proj4
   * reprojections + an oriented-bounding-box fit) and frame-invariant, so
   * caching them keeps repeated traversals (animation frames) cheap. See
   * `dev-docs/specs/2026-05-11-traversal-bounding-volume-cache-design.md`.
   *
   * @default 65536
   */
  maxBoundingVolumeCacheSize?: number;
}

/**
 * A generic tileset implementation organized according to the OGC
 * [TileMatrixSet](https://docs.ogc.org/is/17-083r4/17-083r4.html)
 * specification.
 *
 * Handles tile lifecycle, caching, and viewport-based loading.
 */
export class RasterTileset2D extends Tileset2D {
  private descriptor: RasterTilesetDescriptor;
  private wgs84Bounds: Bounds;
  private getPixelRatio: () => number;
  private boundingVolumeCache: BoundingVolumeCache;

  constructor(
    opts: Tileset2DProps,
    descriptor: RasterTilesetDescriptor,
    { getPixelRatio, maxBoundingVolumeCacheSize }: RasterTileset2DOptions = {},
  ) {
    super(opts);
    this.descriptor = descriptor;
    this.getPixelRatio = getPixelRatio ?? (() => 1);
    this.boundingVolumeCache = new BoundingVolumeCache({
      maxEntries: maxBoundingVolumeCacheSize,
    });

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
      boundingVolumeCache: this.boundingVolumeCache,
    });

    return this.sortTileIndicesByDistance(tileIndices, viewport);
  }

  /**
   * Sort tile indices by ascending distance from the viewport center in
   * projected (common/world) space so loads initiate center-out.
   *
   * Short-circuits when `tileIndices.length <= maxRequests` — all fetches
   * would start concurrently regardless of order in that case. Mutates and
   * returns `tileIndices`.
   */
  private sortTileIndicesByDistance(
    tileIndices: TileIndex[],
    viewport: Viewport,
  ): TileIndex[] {
    console.log("unsorted", tileIndices);
    const maxRequests = this.opts.maxRequests;
    const threshold =
      typeof maxRequests === "number" && maxRequests > 0 ? maxRequests : 1;
    if (tileIndices.length <= threshold) {
      return tileIndices;
    }

    // Work in WGS84 throughout. `viewport.center` is in deck.gl common
    // space (e.g. ~[270, 327] for a WebMercator viewport), which isn't
    // directly comparable to projected tile corners in the tileset's CRS.
    // `viewport.getBounds()` always returns [minLng, minLat, maxLng, maxLat]
    // in WGS84, and we convert projected tile centers through the
    // descriptor's `projectTo4326` to match.
    const bounds = viewport.getBounds();
    if (!bounds) {
      return tileIndices;
    }
    const reference: readonly [number, number] = [
      (bounds[0] + bounds[2]) * 0.5,
      (bounds[1] + bounds[3]) * 0.5,
    ];

    const descriptor = this.descriptor;
    return sortByDistanceFromPoint(tileIndices, {
      reference,
      getCenter: (idx) => {
        const corners = descriptor.levels[idx.z]!.projectedTileCorners(
          idx.x,
          idx.y,
        );
        const pcx = (corners.topLeft[0] + corners.bottomRight[0]) * 0.5;
        const pcy = (corners.topLeft[1] + corners.bottomRight[1]) * 0.5;
        return descriptor.projectTo4326(pcx, pcy);
      },
    });
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

  override getTileMetadata(index: TileIndex): RasterTileMetadata {
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

    const { forwardTransform, inverseTransform } =
      levelDescriptor.tileTransform(x, y);

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
      forwardTransform,
      inverseTransform,
    };
  }
}
