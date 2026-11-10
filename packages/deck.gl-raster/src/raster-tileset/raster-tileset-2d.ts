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
  _Tile2DHeader as Tile2DHeader,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
import { transformBounds } from "@developmentseed/proj";
import type { InitialTriangulation } from "@developmentseed/raster-reproject";
import type { Matrix4 } from "@math.gl/core";
import { updateTileStateBestAvailable } from "./best-available.js";
import { BoundingVolumeCache } from "./bounding-volume-cache.js";
import { intersectBounds } from "./bounds.js";
import {
  getTileIndices,
  rescaleCommonSpaceToEPSG3857,
  rescaleEPSG3857ToCommonSpace,
} from "./raster-tile-traversal.js";
import { overlappingTileSpan, TILE_EDGE_TOLERANCE } from "./tile-span.js";
import type {
  RasterTilesetDescriptor,
  RasterTilesetLevel,
} from "./tileset-interface.js";
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
   * Seed triangulation that clamps this tile's reprojection mesh to the valid
   * Web Mercator latitude band (±85.051°), or `undefined` if no clamp is needed.
   * Consumed only by the Web Mercator render path; the globe path renders the
   * full mesh. See {@link createInitialWebMercatorTriangulation}.
   */
  _webMercatorInitialTriangulation?: InitialTriangulation;
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

  /**
   * Abort a tile's load as soon as the tile is neither selected nor visible,
   * not only while more than `maxRequests` loads are in flight as deck.gl
   * does. Needed by layers that hand a whole selection to a range reader at
   * once; deck.gl requests an aborted tile again when it is selected again.
   *
   * @default false
   */
  abortUnwantedLoads?: boolean;
}

/**
 * How many tiles of `level` fit across one tile of `coarser`, the next coarser
 * level, as `[x, y]`, from their tiles' sizes on the ground.
 */
function decimation(
  level: RasterTilesetLevel,
  coarser: RasterTilesetLevel,
): [number, number] {
  return [
    (coarser.metersPerPixel * coarser.tileWidth) /
      (level.metersPerPixel * level.tileWidth),
    (coarser.metersPerPixel * coarser.tileHeight) /
      (level.metersPerPixel * level.tileHeight),
  ];
}

/**
 * Whether `level`'s tiles are larger than those of `coarser`, the next coarser
 * level, so that each covers several of them. COGs whose overviews use smaller
 * tiles than the full-resolution image have such a level. See #873.
 */
function hasLargerTiles(
  level: RasterTilesetLevel,
  coarser: RasterTilesetLevel,
): boolean {
  const [x, y] = decimation(level, coarser);
  return x < 1 - TILE_EDGE_TOLERANCE || y < 1 - TILE_EDGE_TOLERANCE;
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
  private abortUnwantedLoads: boolean;
  private boundingVolumeCache: BoundingVolumeCache;
  private projectPosition: ProjectionFunction;
  private unprojectPosition: ProjectionFunction;
  /**
   * Projection mode of the viewport on the previous `getTileIndices` call.
   * `undefined` until the first call. Used to clear {@link boundingVolumeCache}
   * on a globe↔mercator switch (volumes are not valid across projection modes).
   */
  private lastViewportIsGlobe?: boolean;
  /**
   * The first level whose tiles are larger than the next coarser level's, or
   * `Infinity`. Below it, deck.gl's tile tree, which gives each tile one
   * parent, holds.
   */
  private firstLargerTileLevel: number;
  /** Each tile's {@link _parentIndices}, which don't change. */
  private tileParentIndices: WeakMap<Tile2DHeader, TileIndex[]>;

  constructor(
    opts: Tileset2DProps,
    descriptor: RasterTilesetDescriptor,
    {
      getPixelRatio,
      maxBoundingVolumeCacheSize,
      abortUnwantedLoads = false,
    }: RasterTileset2DOptions = {},
  ) {
    super(opts);
    this.descriptor = descriptor;
    this.getPixelRatio = getPixelRatio ?? (() => 1);
    this.abortUnwantedLoads = abortUnwantedLoads;
    this.boundingVolumeCache = new BoundingVolumeCache({
      maxEntries: maxBoundingVolumeCacheSize,
    });
    const largerTileLevel = descriptor.levels.findIndex(
      (level, z) => z > 0 && hasLargerTiles(level, descriptor.levels[z - 1]!),
    );
    this.firstLargerTileLevel =
      largerTileLevel === -1 ? Infinity : largerTileLevel;
    this.tileParentIndices = new WeakMap();

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
   * deck.gl's options, with `onTileUnload` wrapped to abort a still-loading
   * tile first when {@link RasterTileset2DOptions.abortUnwantedLoads} is on:
   * deck.gl evicts such tiles inside `update`, before {@link update}'s own
   * pass sees them, and with the `best-available` refinement strategy
   * replaced by {@link _bestAvailable}.
   */
  override setOptions(opts: Tileset2DProps): void {
    const { onTileUnload, refinementStrategy } = opts;
    super.setOptions({
      ...opts,
      onTileUnload: (tile) => {
        if (this.abortUnwantedLoads && tile.isLoading) {
          tile.abort();
        }
        onTileUnload?.(tile);
      },
      // deck.gl takes a missing strategy as `best-available`.
      ...("refinementStrategy" in opts &&
        (refinementStrategy ?? "best-available") === "best-available" && {
          refinementStrategy: (tiles: Tile2DHeader[]) =>
            this._bestAvailable(tiles),
        }),
    });
  }

  /**
   * deck.gl's `best-available` refinement, except that from
   * {@link firstLargerTileLevel} up, a tile's parents are all the cached tiles
   * it covers of the next coarser level, rather than one of them. See #873.
   */
  private _bestAvailable(tiles: Tile2DHeader[]): void {
    let byId: Map<string, Tile2DHeader> | undefined;
    updateTileStateBestAvailable(tiles, (tile) => {
      if (tile.index.z < this.firstLargerTileLevel) {
        return tile.parent ? [tile.parent] : [];
      }
      let parentIndices = this.tileParentIndices.get(tile);
      if (!parentIndices) {
        parentIndices = this._parentIndices(tile.index);
        this.tileParentIndices.set(tile, parentIndices);
      }
      byId ??= new Map(tiles.map((t) => [t.id, t]));
      return this._cachedTiles(parentIndices, byId);
    });
  }

  /**
   * deck.gl's update, then the abort of every loading tile that is neither
   * selected nor visible, when
   * {@link RasterTileset2DOptions.abortUnwantedLoads} is on.
   */
  override update(...args: Parameters<Tileset2D["update"]>): number {
    const frame = super.update(...args);
    if (this.abortUnwantedLoads) {
      for (const tile of this.tiles) {
        if (tile.isLoading && !tile.isSelected && !tile.isVisible) {
          tile.abort();
        }
      }
    }
    return frame;
  }

  /**
   * Unloads every cached tile. deck.gl's `Tileset2D.finalize` clears its cache
   * without calling `onTileUnload`, so GPU resources that `getTileData` made
   * for those tiles, like textures, would be freed only by garbage collection.
   * A tile still loading is unloaded once its load finishes, since deck.gl
   * keeps the data that `getTileData` returns after an abort. Not needed once
   * https://github.com/visgl/deck.gl/pull/10883 lands.
   */
  override finalize(): void {
    const { onTileUnload } = this.opts;
    for (const tile of this.tiles) {
      if (tile.isLoading) {
        // `data` is a promise until the load finishes.
        void Promise.resolve(tile.data).then(() => onTileUnload(tile));
      } else {
        onTileUnload(tile);
      }
    }
    super.finalize();
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
   *
   * Unlike in deck.gl's default tileset, `extent` does not keep tiles loading
   * below `minZoom`.
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

    // Limit tile selection to those within WGS84 extent bbox
    let wgs84Bounds = this.wgs84Bounds;
    const { extent } = this.opts;
    if (extent) {
      wgs84Bounds = intersectBounds(wgs84Bounds, extent as Bounds);
      // An extent that misses (or only touches) the data selects nothing.
      if (
        wgs84Bounds[0] >= wgs84Bounds[2] ||
        wgs84Bounds[1] >= wgs84Bounds[3]
      ) {
        return [];
      }
    }

    const maxAvailableZ = this.descriptor.levels.length - 1;
    const maxZ =
      typeof opts.maxZoom === "number"
        ? Math.min(opts.maxZoom, maxAvailableZ)
        : maxAvailableZ;

    return getTileIndices(this.descriptor, {
      viewport,
      maxZ,
      zRange: opts.zRange ?? null,
      wgs84Bounds,
      pixelRatio: this.getPixelRatio(),
      boundingVolumeCache: this.boundingVolumeCache,
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
    const [decimationX, decimationY] = decimation(
      currentOverview,
      parentOverview,
    );

    // Pick the parent containing the child's center: decimation is often a
    // little off a whole number, so the child's corner can fall in a
    // neighboring parent. A last tile holding a sliver of data can have its
    // center past the parent level's edge, hence the clamp. See #841.
    return {
      x: Math.min(
        Math.floor((index.x + 0.5) / decimationX),
        parentOverview.matrixWidth - 1,
      ),
      y: Math.min(
        Math.floor((index.y + 0.5) / decimationY),
        parentOverview.matrixHeight - 1,
      ),
      z: index.z - 1,
    };
  }

  /**
   * The tiles of the next coarser level that the tile at `index` overlaps:
   * the one {@link getParentIndex} picks, unless its level has larger tiles.
   */
  private _parentIndices(index: TileIndex): TileIndex[] {
    const { x, y, z } = index;
    if (z === 0) {
      return [];
    }
    const level = this.descriptor.levels[z]!;
    const coarser = this.descriptor.levels[z - 1]!;
    if (!hasLargerTiles(level, coarser)) {
      return [this.getParentIndex(index)];
    }
    // Overview sizes are rounded to whole pixels, so the two levels' tile
    // edges drift apart by up to a pixel of the coarser level. Within a pixel
    // of an edge counts as on it.
    const [decimationX, decimationY] = decimation(level, coarser);
    const [minCol, lastCol] = overlappingTileSpan(
      x / decimationX,
      (x + 1) / decimationX,
      { tolerance: 1 / coarser.tileWidth },
    );
    const [minRow, lastRow] = overlappingTileSpan(
      y / decimationY,
      (y + 1) / decimationY,
      { tolerance: 1 / coarser.tileHeight },
    );
    // The last tile of a level can reach past the coarser level's last tile.
    const maxCol = Math.min(lastCol, coarser.matrixWidth - 1);
    const maxRow = Math.min(lastRow, coarser.matrixHeight - 1);
    const indices: TileIndex[] = [];
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        indices.push({ x: col, y: row, z: z - 1 });
      }
    }
    return indices;
  }

  /**
   * The cached tiles at `indices`, with each one that isn't cached replaced
   * by the cached tiles nearest above it.
   */
  private _cachedTiles(
    indices: TileIndex[],
    byId: Map<string, Tile2DHeader>,
  ): Tile2DHeader[] {
    const found = new Set<Tile2DHeader>();
    for (const index of indices) {
      const tile = byId.get(this.getTileId(index));
      if (tile) {
        found.add(tile);
      } else {
        const parents = this._parentIndices(index);
        for (const ancestor of this._cachedTiles(parents, byId)) {
          found.add(ancestor);
        }
      }
    }
    return [...found];
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
      _webMercatorInitialTriangulation,
    };
  }
}
