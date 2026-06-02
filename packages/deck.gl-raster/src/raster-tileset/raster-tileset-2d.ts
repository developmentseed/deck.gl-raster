/**
 * RasterTileset2D - Generic tile traversal over a tile pyramid with Frustum
 * Culling
 *
 * This version properly implements frustum culling and bounding volume calculations
 * following the pattern from deck.gl's OSM tile indexing.
 */

import type { Viewport } from "@deck.gl/core";
import { _GlobeViewport as GlobeViewport } from "@deck.gl/core";
import type {
  GeoBoundingBox,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
import { transformBounds } from "@developmentseed/proj";
import type { InitialTriangulation } from "@developmentseed/raster-reproject";
import type { Matrix4 } from "@math.gl/core";
import type { AntimeridianCut } from "./antimeridian-cut.js";
import { antimeridianCut } from "./antimeridian-cut.js";
import { BoundingVolumeCache } from "./bounding-volume-cache.js";
import {
  getTileIndices,
  rescaleCommonSpaceToEPSG3857,
  rescaleEPSG3857ToCommonSpace,
  TILE_SIZE,
} from "./raster-tile-traversal.js";
import { sortItemsByDistanceFromViewportCenter } from "./sort-by-distance.js";
import type { RasterTilesetDescriptor } from "./tileset-interface.js";
import type {
  Bounds,
  Corners,
  ProjectedBoundingBox,
  ProjectionFunction,
  TileIndex,
  ZRange,
} from "./types.js";
import { createInitialWebMercatorTriangulation } from "./web-mercator-clamp.js";

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

  /**
   * Forward (source CRS → deck.gl common space) projection.
   *
   * Mirrors deck.gl's `Viewport.projectPosition` but for this descriptor's
   * source CRS rather than lng/lat. Descriptor-global (identical for every
   * tile) and built once on the tileset, so the reference is stable for the
   * tileset's lifetime — which is what `RasterLayer`'s `reprojectionFnsChanged`
   * check relies on to avoid regenerating the mesh every render.
   */
  _projectPosition: ProjectionFunction;

  /**
   * Inverse (deck.gl common space → source CRS) projection.
   *
   * Mirrors deck.gl's `Viewport.unprojectPosition`. Same stability guarantees
   * as {@link RasterTileMetadata._projectPosition}.
   */
  _unprojectPosition: ProjectionFunction;

  /**
   * Source CRS → common space, but with the +180° seam flipped to the negative
   * side (common-x ≈ 0). Used as the `forwardReproject` for the east/wrapped
   * piece of an antimeridian-crossing tile so that piece does not span the
   * whole world. Same stability guarantees as
   * {@link RasterTileMetadata._projectPosition}.
   */
  _projectPositionWrapped: ProjectionFunction;

  /**
   * Seed triangulation that clamps this tile's reprojection mesh to the valid
   * Web Mercator latitude band (±85.051°), or `undefined` if no clamp is needed.
   * Consumed only by the Web Mercator render path; the globe path renders the
   * full mesh. See {@link createInitialWebMercatorTriangulation}.
   */
  _webMercatorInitialTriangulation?: InitialTriangulation;

  /**
   * Vertical cut at which this tile crosses ±180°, or `undefined` if the tile
   * does not cross the antimeridian (or crosses with a slanted/curved cut that
   * the MVP does not yet handle). Consumed by `RasterTileLayer._renderSubLayers`
   * in the Web Mercator branch to split the tile into a west + east piece. See
   * {@link antimeridianCut}.
   */
  _antimeridianCut?: AntimeridianCut;
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
  private projectPosition: ProjectionFunction;
  private projectPositionWrapped: ProjectionFunction;
  private unprojectPosition: ProjectionFunction;
  /**
   * Projection mode of the viewport on the previous `getTileIndices` call.
   * `undefined` until the first call. Used to clear {@link boundingVolumeCache}
   * on a globe↔mercator switch (volumes are not valid across projection modes).
   */
  private lastViewportIsGlobe?: boolean;

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

    // Source-CRS ↔ deck.gl common-space projection, built once here so the
    // closures are reference-stable for the tileset's lifetime. Exposed on
    // each tile's metadata; `RasterTileLayer._renderSubLayers` reads them off
    // the tile to keep `RasterLayer`'s reprojection-equality check stable
    // across renders (deck.gl recreates the layer instance every render, so
    // per-render-derived closures would regenerate the mesh every frame).
    this.projectPosition = (x, y) =>
      rescaleEPSG3857ToCommonSpace(descriptor.projectTo3857(x, y));
    this.unprojectPosition = (cx, cy) => {
      const [mx, my] = rescaleCommonSpaceToEPSG3857([cx, cy]);
      return descriptor.projectFrom3857(mx, my);
    };

    // Wrapped variant for the negative-side (east) piece of an
    // antimeridian-crossing tile. proj4 normalizes the ±180° seam to +180°, so
    // the seam vertex projects to common-x ≈ TILE_SIZE (the +max boundary)
    // while the rest of that piece sits near 0 — making the piece span the
    // whole world and diverge. Flip any vertex that comes back on the positive
    // side (common-x > TILE_SIZE / 2) by one world-width so the seam lands at
    // ≈ 0. Only the seam vertex is affected; output-sign-based and
    // deterministic. See dev-docs/specs/2026-05-27-antimeridian-crossing-tile-design.md.
    this.projectPositionWrapped = (x, y) => {
      const [cx, cy] = this.projectPosition(x, y);
      return cx > TILE_SIZE / 2 ? [cx - TILE_SIZE, cy] : [cx, cy];
    };

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

    // A tile's bounding volume is computed in a different common space under a
    // GlobeView than under Web Mercator, but the cache key is only (z, x, y).
    // When the viewport's projection mode flips, drop the stale volumes. This
    // mirrors the `project` gate in the tile traversal. (See
    // BoundingVolumeCache.)
    const isGlobe = Boolean(
      viewport instanceof GlobeViewport && viewport.resolution,
    );
    if (
      this.lastViewportIsGlobe !== undefined &&
      this.lastViewportIsGlobe !== isGlobe
    ) {
      this.boundingVolumeCache.clear();
    }
    this.lastViewportIsGlobe = isGlobe;

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
    const { maxRequests } = this.opts;
    if (tileIndices.length <= maxRequests) {
      return tileIndices;
    }

    const descriptor = this.descriptor;
    return sortItemsByDistanceFromViewportCenter(
      tileIndices,
      viewport,
      (tileIndex) => {
        const { x, y, z } = tileIndex;

        const { topLeft, bottomRight } = descriptor.levels[
          z
        ]!.projectedTileCorners(x, y);
        const projectedCenter = [
          (topLeft[0] + bottomRight[0]) / 2,
          (topLeft[1] + bottomRight[1]) / 2,
        ] as const;
        return descriptor.projectTo4326(projectedCenter[0], projectedCenter[1]);
      },
    );
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

    // Clamp the reprojection mesh to the valid Web Mercator latitude band for
    // tiles that extend past ±85.051° (e.g. a global EPSG:4326 image reaching
    // ±90°). Computed once here so the reference is stable across renders.
    const cornerLat = (corner: [number, number]) =>
      this.descriptor.projectTo4326(corner[0], corner[1])[1];
    const _webMercatorInitialTriangulation =
      createInitialWebMercatorTriangulation({
        topLeft: cornerLat(topLeft),
        topRight: cornerLat(topRight),
        bottomLeft: cornerLat(bottomLeft),
        bottomRight: cornerLat(bottomRight),
      });

    // Detect whether this tile crosses ±180° and locate the vertical cut.
    // Corner longitudes are native (as proj4 returns them — un-normalized for a
    // 4326 source with an origin past ±180°). See {@link antimeridianCut}.
    const cornerLng = (corner: [number, number]) =>
      this.descriptor.projectTo4326(corner[0], corner[1])[0];
    const _antimeridianCut = antimeridianCut({
      topLeft: cornerLng(topLeft),
      topRight: cornerLng(topRight),
      bottomLeft: cornerLng(bottomLeft),
      bottomRight: cornerLng(bottomRight),
    });

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
      _projectPosition: this.projectPosition,
      _unprojectPosition: this.unprojectPosition,
      _projectPositionWrapped: this.projectPositionWrapped,
      _webMercatorInitialTriangulation,
      _antimeridianCut,
    };
  }
}
