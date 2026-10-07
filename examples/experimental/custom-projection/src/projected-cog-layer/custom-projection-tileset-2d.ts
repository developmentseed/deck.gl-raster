import type { Viewport } from "@deck.gl/core";
import type {
  GeoBoundingBox,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
import type {
  Bounds,
  Corners,
  ProjectionFunction,
  RasterTilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import type { InitialTriangulation } from "@developmentseed/raster-reproject";
import type { Matrix4 } from "@math.gl/core";
import { AxisAlignedBoundingBox, CullingVolume, Plane } from "@math.gl/culling";
import { worldToPixels } from "@math.gl/web-mercator";
import type { ProjectionContext } from "./projection-context.js";
import { isCustomProjectionViewport } from "./projection-context.js";
import type { PixelRect, Point } from "./tile-geometry.js";
import {
  boundsIntersect,
  computeDomainPixelRect,
  cornersToLngLat,
  insideBounds,
  isGeographicGrid,
  pointsBounds,
  ringArea,
  sampleBoundary,
  sampleGrid,
  wrapLongitudeDelta,
} from "./tile-geometry.js";

/** `(x, y, z)` index of a tile; `z` is the overview level, 0 = coarsest. */
export type TileIndex = { x: number; y: number; z: number };

/**
 * Per-tile metadata attached by {@link CustomProjectionTileset2D}.
 *
 * deck.gl copies these fields onto each `Tile2DHeader`, so the projected
 * layer reads reference-stable values off the tile on every render.
 */
export type ProjectedTileMetadata = {
  /** Lng/lat bounds; deck.gl reads `bbox` when culling tiles for picking. */
  bbox: GeoBoundingBox;
  /** Tile width in pixels. */
  tileWidth: number;
  /** Tile height in pixels. */
  tileHeight: number;
  /** Tile-local pixel → source CRS. */
  forwardTransform: ProjectionFunction;
  /** Source CRS → tile-local pixel. */
  inverseTransform: ProjectionFunction;
  /**
   * Map meters → source CRS, on this tile's side of the antimeridian. See
   * {@link CustomProjectionTileset2D.getTileMetadata}.
   */
  inverseReproject: ProjectionFunction;
  /** The tile's outline in map meters, for debug rendering. */
  mapRing: Point[];
  /**
   * The part of the tile inside the projection's domain, in tile-local
   * pixels, when only part of it is. See {@link computeDomainPixelRect}.
   */
  domainPixelRect: PixelRect | undefined;
  /** Whether the tile has no part inside the projection's domain. */
  outsideDomain: boolean;
  /**
   * Render-time cache of the mesh seed derived from `domainPixelRect` for the
   * decoded tile size (see `ProjectedCOGLayer`). Kept on the tile so the seed
   * is reference-stable across renders.
   */
  _domainSeed?: {
    width: number;
    height: number;
    seed: InitialTriangulation | undefined;
  };
};

/** Options for {@link CustomProjectionTileset2D}. */
export interface CustomProjectionTileset2DOptions {
  /** Drawing-buffer pixels per CSS pixel, read on every traversal. */
  getPixelRatio?: () => number;
}

/** Points sampled along each tile edge to trace its projected outline. */
const SAMPLES_PER_EDGE = 16;

/** Interior grid (per side) probed when testing a tile against the domain. */
const INTERIOR_GRID_SIZE = 8;

/** Relative inset applied to a parent's bounds when finding its children. */
const CHILD_BOUNDS_INSET = 1e-9;

/**
 * deck.gl-raster's LOD measures screen pixels with the 256-px OSM zoom
 * convention, while deck.gl's zoom 0 is 512 px wide: one OSM pixel is two
 * CSS pixels.
 */
const OSM_PIXELS_PER_CSS_PIXEL = 2;

/** Drop the geometry cache past this many tiles; it refills lazily. */
const MAX_CACHED_GEOMETRIES = 20_000;

/**
 * Above this many tiles in the coarsest level, give up instead of
 * enumerating them all. COGs have one or a few tiles at their coarsest level.
 */
const MAX_ROOT_TILES = 10_000;

type TileGeometry = {
  /** Outline in map meters. */
  mapRing: Point[];
  /** Common-space bounds of the outline, for frustum culling. */
  boundingVolume: AxisAlignedBoundingBox;
  /** Lng/lat bounds of the outline. */
  lngLatBounds: Bounds | null;
  /** Whether no part of the tile is inside the projection's domain. */
  outsideDomain: boolean;
  /** See {@link ProjectedTileMetadata.domainPixelRect}. */
  domainPixelRect: PixelRect | undefined;
  /**
   * Outline, in common space, of the part of the tile that is actually drawn:
   * inside the image (edge tiles are clipped) and inside the domain.
   */
  drawnRing: Point[];
  /** Number of source pixels in that part. */
  drawnPixels: number;
};

type TraversalContext = {
  viewport: Viewport;
  cullingVolume: CullingVolume;
  maxZ: number;
  pixelRatio: number;
  /**
   * Result of `visit` per tile id. Levels need not nest, so a tile can be
   * reached from several parents; each is evaluated (and selected) once.
   */
  visited: Map<string, boolean>;
};

/**
 * Tile selection for a raster pyramid displayed in a custom (planar)
 * projection.
 *
 * deck.gl-raster's `RasterTileset2D` selects tiles in Web Mercator or globe
 * space. This variant works in the view's map CRS instead:
 *
 * - **Culling**: each tile's outline is sampled in the source CRS, projected
 *   to map meters and then common space, and its bounding box tested against
 *   the camera frustum.
 * - **Level of detail**: the same criterion as deck.gl-raster's
 *   `RasterTileset2D` (see `isFineEnough`), with a source pixel's size
 *   measured from the screen area of the part of the tile that is drawn. That
 *   accounts for the projection's distortion wherever the tile lies.
 * - **Domain**: tiles entirely outside the projection's domain (`fromBounds`)
 *   are skipped, and partially outside geographic tiles get a mesh seed that
 *   trims them to the domain.
 * - **Selection**: each tile is selected at most once, and never together
 *   with one of its ancestors.
 *
 * It only works with custom-projection viewports, and assumes a top-down
 * camera (the screen-area LOD is exact for orthographic views).
 */
export class CustomProjectionTileset2D extends Tileset2D {
  private readonly descriptor: RasterTilesetDescriptor;
  private readonly projection: ProjectionContext;
  private readonly getPixelRatio: () => number;
  private readonly geometryCache = new Map<string, TileGeometry>();

  constructor(
    opts: Tileset2DProps,
    descriptor: RasterTilesetDescriptor,
    projection: ProjectionContext,
    { getPixelRatio }: CustomProjectionTileset2DOptions = {},
  ) {
    super(opts);
    this.descriptor = descriptor;
    this.projection = projection;
    this.getPixelRatio = getPixelRatio ?? (() => 1);
  }

  override getTileIndices(opts: {
    viewport: Viewport;
    maxZoom?: number;
    minZoom?: number;
    zRange: [number, number] | null;
    modelMatrix?: Matrix4;
    modelMatrixInverse?: Matrix4;
  }): TileIndex[] {
    const { viewport, minZoom } = opts;
    if (
      !isCustomProjectionViewport(viewport) ||
      viewport.projectionSignature !== this.projection.signature
    ) {
      return [];
    }
    if (typeof minZoom === "number" && viewport.zoom < minZoom) {
      return [];
    }

    const maxAvailableZ = this.descriptor.levels.length - 1;
    const maxZ =
      typeof opts.maxZoom === "number"
        ? Math.min(opts.maxZoom, maxAvailableZ)
        : maxAvailableZ;

    // Same construction as deck.gl's tile traversal.
    const planes = Object.values(viewport.getFrustumPlanes()).map(
      ({ normal, distance }) => new Plane(normal.clone().negate(), distance),
    );
    const context: TraversalContext = {
      viewport,
      cullingVolume: new CullingVolume(planes),
      maxZ,
      pixelRatio: this.getPixelRatio(),
      visited: new Map(),
    };

    if (this.geometryCache.size > MAX_CACHED_GEOMETRIES) {
      this.geometryCache.clear();
    }

    const rootLevel = this.descriptor.levels[0]!;
    if (rootLevel.matrixWidth * rootLevel.matrixHeight > MAX_ROOT_TILES) {
      console.warn(
        "CustomProjectionTileset2D: too many tiles in the coarsest level",
      );
      return [];
    }

    const selected: TileIndex[] = [];
    for (let y = 0; y < rootLevel.matrixHeight; y++) {
      for (let x = 0; x < rootLevel.matrixWidth; x++) {
        this.visit({ x, y, z: 0 }, context, selected);
      }
    }
    return selected;
  }

  /**
   * Release every cached tile's resources before dropping the cache.
   *
   * deck.gl's `Tileset2D.finalize` clears the cache without calling
   * `onTileUnload`, so the tiles' GPU textures would leak each time the tile
   * layer is replaced, which this example does on every projection or dataset
   * change.
   */
  override finalize(): void {
    for (const tile of this.tiles) {
      this.opts.onTileUnload?.(tile);
    }
    super.finalize();
  }

  override getTileId(index: TileIndex): string {
    return `${index.x}-${index.y}-${index.z}`;
  }

  override getTileZoom(index: TileIndex): number {
    return index.z;
  }

  /** Same parent lookup as deck.gl-raster's `RasterTileset2D`. */
  override getParentIndex(index: TileIndex): TileIndex {
    if (index.z === 0) {
      return index;
    }
    const current = this.descriptor.levels[index.z]!;
    const parent = this.descriptor.levels[index.z - 1]!;
    const decimationX =
      (parent.metersPerPixel * parent.tileWidth) /
      (current.metersPerPixel * current.tileWidth);
    const decimationY =
      (parent.metersPerPixel * parent.tileHeight) /
      (current.metersPerPixel * current.tileHeight);
    return {
      x: Math.floor(index.x / decimationX),
      y: Math.floor(index.y / decimationY),
      z: index.z - 1,
    };
  }

  override getTileMetadata(index: TileIndex): ProjectedTileMetadata {
    const { x, y, z } = index;
    const level = this.descriptor.levels[z]!;
    const { tileWidth, tileHeight } = level;
    const geometry = this.getGeometry(index);
    const { forwardTransform, inverseTransform } = level.tileTransform(x, y);

    const [west, south, east, north] = geometry.lngLatBounds ?? [0, 0, 0, 0];
    return {
      bbox: { west, south, east, north },
      tileWidth,
      tileHeight,
      forwardTransform,
      inverseTransform,
      inverseReproject: this.tileInverseReproject(
        level.projectedTileCorners(x, y),
      ),
      mapRing: geometry.mapRing,
      domainPixelRect: geometry.domainPixelRect,
      outsideDomain: geometry.outsideDomain,
    };
  }

  /**
   * The map → source projection the reprojector uses for one tile.
   *
   * In most projections the antimeridian is just another line on the map
   * (in a polar view, a ray from the pole). The inverse projection still
   * returns longitudes in [-180, 180], so a point just past +180° comes back
   * as -180°: for a geographic tile on the +180° edge, that is the far side
   * of the source grid, and the reprojector's error check sees an error as
   * wide as the whole level and never converges. For geographic tiles,
   * unwrap the inverse's longitude to within 180° of the tile's center.
   */
  private tileInverseReproject(corners: Corners): ProjectionFunction {
    const { sourceToLngLat, lngLatToSource, mapToLngLat, mapToSource } =
      this.projection;
    const lngLatCorners = cornersToLngLat(corners, sourceToLngLat);
    if (!isGeographicGrid(lngLatCorners)) {
      return mapToSource;
    }
    const centerLng =
      (lngLatCorners.topLeft[0] + lngLatCorners.topRight[0]) / 2;
    return (x, y) => {
      const lngLat = mapToLngLat(x, y);
      if (!lngLat) {
        return [Number.NaN, Number.NaN];
      }
      const lng = centerLng + wrapLongitudeDelta(lngLat[0] - centerLng);
      return lngLatToSource(lng, lngLat[1]);
    };
  }

  /**
   * Select `index` or its descendants. Returns whether anything at or below
   * this tile is visible.
   */
  private visit(
    index: TileIndex,
    context: TraversalContext,
    selected: TileIndex[],
  ): boolean {
    const id = this.getTileId(index);
    const previous = context.visited.get(id);
    if (previous !== undefined) {
      return previous;
    }
    const visible = this.visitOnce(index, context, selected);
    context.visited.set(id, visible);
    return visible;
  }

  private visitOnce(
    index: TileIndex,
    context: TraversalContext,
    selected: TileIndex[],
  ): boolean {
    const geometry = this.getGeometry(index);
    if (geometry.outsideDomain) {
      return false;
    }
    if (context.cullingVolume.computeVisibility(geometry.boundingVolume) < 0) {
      return false;
    }

    const children = index.z < context.maxZ ? this.getChildren(index) : [];
    if (children.length === 0 || this.isFineEnough(geometry, context)) {
      selected.push(index);
      return true;
    }

    let anyChildVisible = false;
    for (const child of children) {
      if (this.visit(child, context, selected)) {
        anyChildVisible = true;
      }
    }
    return anyChildVisible;
  }

  /**
   * Whether the tile is detailed enough for the screen.
   *
   * Measures the on-screen size of one source pixel from the screen area of
   * the part of the tile that is drawn, then applies the same criterion as
   * deck.gl-raster's `RasterTileset2D`: source pixel ≤ "screen pixel", where
   * that traversal's screen pixel follows the 256-px OSM zoom convention
   * (`dev-docs/lod-and-pixel-matching.md`), i.e. two of deck.gl's CSS pixels.
   * Matching it keeps tile resolution comparable with the Web Mercator map.
   */
  private isFineEnough(
    geometry: TileGeometry,
    context: TraversalContext,
  ): boolean {
    if (geometry.drawnPixels <= 0) {
      return true;
    }
    const { viewport, pixelRatio } = context;
    const screenRing = geometry.drawnRing.map((common) => {
      const pixel = worldToPixels(
        [common[0], common[1], 0],
        viewport.pixelProjectionMatrix,
      );
      return [pixel[0]!, pixel[1]!] as Point;
    });
    const cssPixelsPerSourcePixel = Math.sqrt(
      ringArea(screenRing) / geometry.drawnPixels,
    );
    return (
      (cssPixelsPerSourcePixel * pixelRatio) / OSM_PIXELS_PER_CSS_PIXEL <= 1
    );
  }

  /** Tiles one level finer that overlap `index` (levels need not nest). */
  private getChildren(index: TileIndex): TileIndex[] {
    const level = this.descriptor.levels[index.z]!;
    const childLevel = this.descriptor.levels[index.z + 1];
    if (!childLevel) {
      return [];
    }
    const { topLeft, topRight, bottomLeft, bottomRight } =
      level.projectedTileCorners(index.x, index.y);
    const xs = [topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]];
    const ys = [topLeft[1], topRight[1], bottomLeft[1], bottomRight[1]];
    // Shrink the bounds a hair: `crsBoundsToTileRange` is inclusive, so a
    // parent edge that lands exactly on a child-tile boundary would otherwise
    // pull in the neighboring parent's children too.
    const insetX = (Math.max(...xs) - Math.min(...xs)) * CHILD_BOUNDS_INSET;
    const insetY = (Math.max(...ys) - Math.min(...ys)) * CHILD_BOUNDS_INSET;
    const { minCol, maxCol, minRow, maxRow } = childLevel.crsBoundsToTileRange(
      Math.min(...xs) + insetX,
      Math.min(...ys) + insetY,
      Math.max(...xs) - insetX,
      Math.max(...ys) - insetY,
    );
    const children: TileIndex[] = [];
    for (let y = minRow; y <= maxRow; y++) {
      for (let x = minCol; x <= maxCol; x++) {
        children.push({ x, y, z: index.z + 1 });
      }
    }
    return children;
  }

  private getGeometry(index: TileIndex): TileGeometry {
    const key = `${index.z}/${index.x}/${index.y}`;
    let geometry = this.geometryCache.get(key);
    if (!geometry) {
      geometry = this.computeGeometry(index);
      this.geometryCache.set(key, geometry);
    }
    return geometry;
  }

  private computeGeometry(index: TileIndex): TileGeometry {
    const level = this.descriptor.levels[index.z]!;
    const { tileWidth, tileHeight } = level;
    const corners = level.projectedTileCorners(index.x, index.y);
    const { forwardTransform, inverseTransform } = level.tileTransform(
      index.x,
      index.y,
    );
    const { sourceToLngLat, lngLatToSource, fromBounds } = this.projection;

    const domainRect = computeDomainPixelRect({
      corners,
      tileWidth,
      tileHeight,
      sourceToLngLat,
      lngLatToSource,
      inverseTransform,
      fromBounds,
    });

    const sourceRing = sampleBoundary(corners, SAMPLES_PER_EDGE);
    const lngLatBounds = pointsBounds(
      sourceRing.map(([x, y]) => sourceToLngLat(x, y)),
    );
    // The outline alone can miss the domain: a polar-native tile around the
    // pole can have its whole outline outside the hemisphere (COG tiles at
    // coarse levels extend well past the image) while its interior covers
    // it. So also probe a grid of interior points.
    const outsideDomain =
      domainRect === null ||
      !lngLatBounds ||
      (fromBounds !== undefined &&
        !boundsIntersect(lngLatBounds, fromBounds) &&
        !sampleGrid(corners, INTERIOR_GRID_SIZE).some(([x, y]) =>
          insideBounds(sourceToLngLat(x, y), fromBounds),
        ));

    const mapRing = this.toMapRing(sourceRing);
    const bounds = pointsBounds(
      mapRing.map(([x, y]) => this.toCommon(x, y)),
    ) ?? [0, 0, 0, 0];

    // Level of detail is measured over what is actually drawn: edge tiles are
    // clipped to the image, and tiles crossing the domain edge are trimmed.
    let drawn = intersectPixelRects(
      this.imagePixelRect(inverseTransform, tileWidth, tileHeight),
      domainRect ?? undefined,
    );
    if (domainRect === null) {
      drawn = [0, 0, 0, 0];
    }
    const drawnPixels =
      Math.max(0, drawn[2] - drawn[0]) * Math.max(0, drawn[3] - drawn[1]);
    const drawnRing =
      drawnPixels > 0
        ? this.toMapRing(
            sampleBoundary(
              {
                topLeft: forwardTransform(drawn[0], drawn[1]),
                topRight: forwardTransform(drawn[2], drawn[1]),
                bottomLeft: forwardTransform(drawn[0], drawn[3]),
                bottomRight: forwardTransform(drawn[2], drawn[3]),
              },
              SAMPLES_PER_EDGE,
            ),
          ).map(([x, y]) => this.toCommon(x, y))
        : [];

    return {
      mapRing,
      boundingVolume: new AxisAlignedBoundingBox(
        [bounds[0], bounds[1], 0],
        [bounds[2], bounds[3], 0],
      ),
      lngLatBounds,
      outsideDomain: outsideDomain || mapRing.length < 3,
      domainPixelRect: domainRect ?? undefined,
      drawnRing,
      drawnPixels,
    };
  }

  /**
   * The part of the tile covered by the image, in tile-local pixels. COG edge
   * tiles extend past the image (their decoded data is clipped).
   */
  private imagePixelRect(
    inverseTransform: ProjectionFunction,
    tileWidth: number,
    tileHeight: number,
  ): PixelRect {
    const [minX, minY, maxX, maxY] = this.descriptor.projectedBounds;
    const a = inverseTransform(minX, maxY);
    const b = inverseTransform(maxX, minY);
    return [
      Math.max(0, Math.min(a[0], b[0])),
      Math.max(0, Math.min(a[1], b[1])),
      Math.min(tileWidth, Math.max(a[0], b[0])),
      Math.min(tileHeight, Math.max(a[1], b[1])),
    ];
  }

  /** Project source-CRS points to map meters, dropping non-finite results. */
  private toMapRing(sourcePoints: Point[]): Point[] {
    const { sourceToMap } = this.projection;
    return sourcePoints
      .map(([x, y]) => sourceToMap(x, y))
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  }

  private toCommon(x: number, y: number): Point {
    return this.projection.mapToCommon(x, y);
  }
}

/** Intersection of two pixel rectangles; `b` is optional. */
function intersectPixelRects(
  a: PixelRect,
  b: PixelRect | undefined,
): PixelRect {
  if (!b) {
    return a;
  }
  return [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
}
