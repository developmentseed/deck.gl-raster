/**
 * This file implements tile traversal for generic 2D tilesets.
 *
 * The main algorithm works as follows:
 *
 * 1. Start at the root tile(s) (z=0, covers the entire image, but not
 *    necessarily the whole world)
 * 2. Test if each tile is visible using viewport frustum culling
 * 3. For visible tiles, compute distance-based LOD (Level of Detail)
 * 4. If LOD is insufficient, recursively subdivide into child tiles
 * 5. Select tiles at appropriate zoom levels based on distance from camera
 *
 * The result is a set of tiles at varying zoom levels that efficiently
 * cover the visible area with appropriate detail.
 *
 * The traversal is driven by a {@link RasterTilesetDescriptor}, which abstracts over
 * both OGC TileMatrixSet grids and Zarr multiscale pyramids.
 */

import type { Viewport } from "@deck.gl/core";
import { _GlobeViewport, assert } from "@deck.gl/core";
import { transformBounds } from "@developmentseed/proj";
import { Vector3 } from "@math.gl/core";
import {
  CullingVolume,
  makeOrientedBoundingBoxFromPoints,
  OrientedBoundingBox,
  Plane,
} from "@math.gl/culling";
import { lngLatToWorld, worldToLngLat } from "@math.gl/web-mercator";

import { BoundingVolumeCache } from "./bounding-volume-cache.js";
import type {
  RasterTilesetDescriptor,
  RasterTilesetLevel,
} from "./tileset-interface.js";
import type {
  Bounds,
  Corners,
  Point,
  ProjectionFunction,
  TileIndex,
  ZRange,
} from "./types.js";

/**
 * The size of the entire world in deck.gl's common coordinate space.
 *
 * The world always spans [0, 512] in both X and Y in Web Mercator common space.
 *
 * At zoom level 0, there is 1 tile that represents the whole world, so that tile is 512x512 units.
 * At zoom level z, there are 2^z tiles along each axis, so each tile is (512 / 2^z) units.
 *
 * The origin (0,0) is at the top-left corner, and (512,512) is at the
 * bottom-right.
 */
const TILE_SIZE = 512;

/**
 * Maximum number of world copies to test on each side of the primary world
 * during multi-world tile traversal. Matches upstream
 * `@deck.gl/geo-layers/tile-2d-traversal.ts`.
 */
const MAX_MAPS = 3;

// Reference points used to sample tile boundaries for bounding volume
// calculation.
//
// In upstream deck.gl code, such reference points are only used in non-Web
// Mercator projections because the OSM tiling scheme is designed for Web
// Mercator and the OSM tile extents are already in Web Mercator projection. So
// using Axis-Aligned bounding boxes based on tile extents is sufficient for
// frustum culling in Web Mercator viewports.
//
// In upstream code these reference points are used for Globe View where the OSM
// tile indices _projected into longitude-latitude bounds in Globe View space_
// are no longer axis-aligned, and oriented bounding boxes must be used instead.
//
// In the context of generic tiling grids which are often not in Web Mercator
// projection, we must use the reference points approach because the grid tiles
// will never be exact axis aligned boxes in Web Mercator space.

// For most tiles: sample 4 corners and center (5 points total)
const REF_POINTS_5: [number, number][] = [
  [0.5, 0.5], // center
  [0, 0], // top-left
  [0, 1], // bottom-left
  [1, 0], // top-right
  [1, 1], // bottom-right
];

// For higher detail: add 4 edge midpoints (9 points total)
const REF_POINTS_9 = REF_POINTS_5.concat([
  [0, 0.5], // left edge
  [0.5, 0], // top edge
  [1, 0.5], // right edge
  [0.5, 1], // bottom edge
]);

/** semi-major axis of the WGS84 ellipsoid
 *
 * EPSG:3857 also uses the WGS84 datum, so this is used for conversions from
 * 3857 to deck.gl common space (scaled to [0-512])
 */
const WGS84_ELLIPSOID_A = 6378137;

/**
 * Full circumference of the EPSG:3857 Web Mercator world, in meters
 */
const EPSG_3857_CIRCUMFERENCE = 2 * Math.PI * WGS84_ELLIPSOID_A;
const EPSG_3857_HALF_CIRCUMFERENCE = EPSG_3857_CIRCUMFERENCE / 2;

// Maximum latitude representable in Web Mercator (EPSG:3857), in degrees.
const MAX_WEB_MERCATOR_LAT = 85.05112877980659;

/**
 * Raster Tile Node - represents a single tile in a tileset pyramid.
 *
 * Akin to the upstream OSMNode class.
 *
 * This node class uses the following coordinate system:
 *
 * - x: tile column (0 to RasterTilesetLevel.matrixWidth, left to right)
 * - y: tile row (0 to RasterTilesetLevel.matrixHeight, top to bottom)
 * - z: overview level. This assumes ordering where: 0 = coarsest, higher = finer
 */
export class RasterTileNode {
  /** Index across a row */
  x: number;

  /** Index down a column */
  y: number;

  /** Zoom index assumed to be (higher = finer detail) */
  z: number;

  private descriptor: RasterTilesetDescriptor;

  /**
   * Flag indicating whether any descendant of this tile is visible.
   *
   * Used to prevent loading parent tiles when children are visible (avoids
   * overdraw).
   */
  private childVisible?: boolean;

  /**
   * Flag indicating this tile should be rendered
   *
   * Set to `true` when this is the appropriate LOD for its distance from camera.
   */
  private selected?: boolean;

  /** A cache of the children of this node. */
  private _children?: RasterTileNode[] | null;

  constructor(
    x: number,
    y: number,
    z: number,
    { descriptor }: { descriptor: RasterTilesetDescriptor },
  ) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.descriptor = descriptor;
  }

  /** Get the level info for this tile's z index. */
  get level(): RasterTilesetLevel {
    return this.descriptor.levels[this.z]!;
  }

  /** Get the children of this node.
   *
   * Find all tiles at level this.z + 1 whose spatial extent overlaps this tile.
   *
   * A tileset pyramid is not guaranteed to be a quadtree — it is a stack of
   * independent grids. We find children by mapping the parent tile's CRS bounds
   * into the child grid using {@link RasterTilesetLevel.crsBoundsToTileRange}.
   */
  get children(): RasterTileNode[] | null {
    if (!this._children) {
      const maxZ = this.descriptor.levels.length - 1;
      if (this.z >= maxZ) {
        // Already at finest resolution, no children
        this._children = null;
        return null;
      }

      const childZ = this.z + 1;
      const childLevel = this.descriptor.levels[childZ]!;

      // Compute this tile's bounds in the source CRS
      const parentCorners = this.level.projectedTileCorners(this.x, this.y);
      const parentBounds = cornersToBounds(parentCorners);

      // Find overlapping child index range
      const { minCol, maxCol, minRow, maxRow } =
        childLevel.crsBoundsToTileRange(...parentBounds);

      const children: RasterTileNode[] = [];
      const { descriptor } = this;
      for (let y = minRow; y <= maxRow; y++) {
        for (let x = minCol; x <= maxCol; x++) {
          children.push(new RasterTileNode(x, y, childZ, { descriptor }));
        }
      }

      this._children = children.length > 0 ? children : null;
    }
    return this._children;
  }

  /**
   * Recursively traverse the tile pyramid to determine if this tile (or its
   * descendants) should be rendered.
   *
   * I.e. "Given this tile node, should I render this tile, or should I recurse
   * into its children?"
   *
   * The algorithm performs:
   * 1. Visibility culling - reject tiles outside the view frustum
   * 2. Bounds checking - reject tiles outside the specified geographic bounds
   * 3. LOD selection - choose appropriate zoom level based on distance from camera
   * 4. Recursive subdivision - if LOD is insufficient, test child tiles
   *
   * Additionally, there should never be overdraw, i.e. a tile should never be
   * rendered if any of its descendants are rendered.
   *
   * @returns true if this tile or any descendant is visible, false otherwise
   */
  update(params: {
    viewport: Viewport;
    // Projection: [lng,lat,z] -> common space. Null for Web Mercator.
    project: ((xyz: number[]) => number[]) | null;
    // Camera frustum for visibility testing
    cullingVolume: CullingVolume;
    // [min, max] elevation in common space
    elevationBounds: ZRange;
    /** Minimum (coarsest) overview level */
    minZ: number;
    /** Maximum (finest) overview level */
    maxZ?: number;
    /** Optional geographic bounds filter */
    bounds?: Bounds;
    /**
     * Device pixels per CSS pixel. The LOD test selects a tile when its
     * source pixels are at most one *device* pixel wide; on HiDPI displays
     * (`pixelRatio > 1`) this picks a finer overview than the CSS-pixel
     * comparison would. See `dev-docs/lod-and-pixel-matching.md` § (A).
     */
    pixelRatio: number;
    /**
     * Number of world copies to shift this tile's bounding volume by along
     * common-space X for frustum testing. Default `0` (primary world).
     * Non-zero passes are additive — they may set `selected = true` but
     * never override a previous `true` to `false`. See
     * `dev-docs/world-copies.md`.
     */
    worldOffset?: number;
    /**
     * Bounding-volume cache shared by every node in this traversal. Populated
     * lazily as tiles are visited; reused across `getTileIndices` calls (so
     * animation frames don't recompute proj4 reprojections + oriented-bounding-
     * box fits). See {@link BoundingVolumeCache}.
     */
    boundingVolumeCache: BoundingVolumeCache;
  }): boolean {
    const {
      viewport,
      cullingVolume,
      elevationBounds,
      minZ,
      maxZ = this.descriptor.levels.length - 1,
      project,
      bounds,
      pixelRatio,
      worldOffset = 0,
      boundingVolumeCache,
    } = params;

    // Reset per-frame state on the primary pass only. Non-zero worldOffset
    // passes are additive — they can flip selected/childVisible from
    // false → true but never the reverse. See dev-docs/world-copies.md.
    if (worldOffset === 0) {
      this.childVisible = false;
      this.selected = false;
    }

    // Get bounding volume for this tile (translated for frustum culling at
    // non-zero worldOffset).
    const { boundingVolume } = this.getBoundingVolume(
      elevationBounds,
      project,
      boundingVolumeCache,
      worldOffset,
    );

    // Step 1: Bounds checking
    // If geographic bounds are specified, reject tiles outside those bounds.
    // The dataset's `bounds` live in primary-world common space, and a tile
    // at `(x, y, z)` represents the same data regardless of which world copy
    // it's drawn in — so always compare against the offset-0 AABB.
    if (bounds) {
      const primaryWorldVolume = this.getBoundingVolume(
        elevationBounds,
        project,
        boundingVolumeCache,
        0,
      );
      if (!this.insideBounds(bounds, primaryWorldVolume.commonSpaceBounds)) {
        return false;
      }
    }

    // Frustum culling
    // Test if tile's bounding volume intersects the camera frustum
    // Returns: <0 if outside, 0 if intersecting, >0 if fully inside
    const isInside = cullingVolume.computeVisibility(boundingVolume);
    if (isInside < 0) {
      return false;
    }

    const children = this.children;

    // LOD (Level of Detail) selection (only if allowed at this level)
    // Only select this tile if no child is visible (prevents overlapping tiles)
    // "When pitch is low, force selection at maxZ."
    if (!this.childVisible && this.z >= minZ) {
      const metersPerCSSPixel = getMetersPerPixelAtBoundingVolume(
        boundingVolume,
        viewport.zoom,
      );

      const tileMetersPerPixel = this.level.metersPerPixel;

      // On-screen size of one source pixel, measured in device pixels.
      // ≤ 1 means the source can fully resolve the rendered framebuffer.
      // See dev-docs/lod-and-pixel-matching.md.
      const devicePixelsPerSourcePixel =
        (tileMetersPerPixel * pixelRatio) / metersPerCSSPixel;

      if (
        devicePixelsPerSourcePixel <= 1 ||
        this.z >= maxZ ||
        (children === null && this.z >= minZ)
      ) {
        this.selected = true;
        return true;
      }
    }

    // LOD is not enough, recursively test child tiles
    //
    // Note that if `this.children` is `null`, then there are no children
    // available because we're already at the finest tile resolution available
    if (children && children.length > 0) {
      if (worldOffset === 0) {
        this.selected = false;
      }

      let anyChildVisible = false;

      for (const child of children) {
        if (child.update(params)) {
          anyChildVisible = true;
        }
      }

      // Only set childVisible to true; never override a previous true to
      // false on a subsequent pass. Offset-0 already starts with
      // childVisible=false (reset above), so this preserves the
      // "any pass that finds a visible child wins" semantics.
      if (anyChildVisible) {
        this.childVisible = true;
      }
      return anyChildVisible;
    }

    return true;
  }

  /**
   * Collect all tiles marked as selected in the tree.
   * Recursively traverses the entire tree and gathers tiles where selected=true.
   *
   * @param result - Accumulator array for selected tiles
   * @returns Array of selected RasterTileNode tiles
   */
  getSelected(result: RasterTileNode[] = []): RasterTileNode[] {
    if (this.selected) {
      result.push(this);
    }
    if (this._children) {
      for (const node of this._children) {
        node.getSelected(result);
      }
    }
    return result;
  }

  /**
   * Test if this tile intersects the specified bounds in Web Mercator space.
   * Used to filter tiles when only a specific geographic region is needed.
   *
   * @param bounds - [minX, minY, maxX, maxY] in Web Mercator units (0-512)
   * @returns true if tile overlaps the bounds
   */
  insideBounds(bounds: Bounds, commonSpaceBounds: Bounds): boolean {
    const [minX, minY, maxX, maxY] = bounds;
    const [tileMinX, tileMinY, tileMaxX, tileMaxY] = commonSpaceBounds;

    const inside =
      tileMinX < maxX && tileMaxX > minX && tileMinY < maxY && tileMaxY > minY;

    return inside;
  }

  /**
   * The 3D bounding volume for this tile in deck.gl's common coordinate space,
   * used for frustum culling.
   *
   * Memoized in `boundingVolumeCache` (keyed by `z/x/y`): a tile's bounding
   * volume depends only on `(z, x, y, zRange)` for a given descriptor, so on a
   * cache hit it is returned without rerunning {@link computeBoundingVolume}'s
   * proj4 reprojections + oriented-bounding-box fit.
   *
   * For non-zero `worldOffset`, returns a translated copy (center shifted by
   * `worldOffset * TILE_SIZE` along common-space X) without polluting the
   * cache — the cache always stores the offset-0 volume. See
   * `dev-docs/world-copies.md`.
   *
   * @param zRange               Elevation `[min, max]` in common-space units.
   * @param project              Projection function for Globe view, or `null`
   *                             for Web Mercator common space.
   * @param boundingVolumeCache  Cache keyed by `z/x/y`. Stores the offset-0
   *                             volume only.
   * @param worldOffset          Number of world copies to translate the result
   *                             by along common-space X. `0` returns the
   *                             cached offset-0 volume directly. Non-zero
   *                             values return a fresh translated copy.
   */
  getBoundingVolume(
    zRange: ZRange,
    project: ((xyz: number[]) => number[]) | null,
    boundingVolumeCache: BoundingVolumeCache,
    worldOffset = 0,
  ): { boundingVolume: OrientedBoundingBox; commonSpaceBounds: Bounds } {
    const cacheHit = boundingVolumeCache.get(this.z, this.x, this.y);
    // `base` is the tile's volume in the primary world (offset 0). The cache
    // only ever stores the primary-world volume; it is returned as-is for
    // worldOffset 0, or translated below for a non-zero offset.
    let base: {
      boundingVolume: OrientedBoundingBox;
      commonSpaceBounds: Bounds;
    };
    if (
      cacheHit &&
      cacheHit.zRange[0] === zRange[0] &&
      cacheHit.zRange[1] === zRange[1]
    ) {
      base = cacheHit;
    } else {
      base = this.computeBoundingVolume(zRange, project);
      boundingVolumeCache.set(this.z, this.x, this.y, { zRange, ...base });
    }
    if (worldOffset === 0) {
      return base;
    }
    return translateBoundingVolume(base, worldOffset * TILE_SIZE);
  }

  /**
   * Compute (without caching) the 3D bounding volume for this tile in deck.gl's
   * common coordinate space.
   *
   * TODO: In the future, we can add a fast path in the case that the source
   * tiling is already in EPSG:3857.
   */
  private computeBoundingVolume(
    zRange: ZRange,
    project: ((xyz: number[]) => number[]) | null,
  ): { boundingVolume: OrientedBoundingBox; commonSpaceBounds: Bounds } {
    // Case 1: Globe view - need to construct an oriented bounding box from
    // reprojected sample points, but also using the `project` param
    if (project) {
      assert(false, "TODO: implement getBoundingVolume in Globe view");
      // Reproject positions to wgs84 instead, then pass them into `project`
      // return makeOrientedBoundingBoxFromPoints(refPointPositions);
    }

    // (Future) Case 2: Web Mercator input image, can directly compute AABB in
    // common space

    // (Future) Case 3: Source projection is already mercator, like UTM. We
    // don't need to sample from reference points, we can only use the 4
    // corners.

    // Case 4: Generic case - sample reference points and reproject to
    // Web Mercator, then convert to deck.gl common space
    return this._getGenericBoundingVolume(zRange);
  }

  /**
   * Generic case - sample reference points and reproject to Web Mercator, then
   * convert to deck.gl common space
   *
   */
  private _getGenericBoundingVolume(zRange: ZRange): {
    boundingVolume: OrientedBoundingBox;
    commonSpaceBounds: Bounds;
  } {
    const [minZ, maxZ] = zRange;

    const tileCorners = this.level.projectedTileCorners(this.x, this.y);

    const refPointsEPSG3857 = sampleReferencePointsInEPSG3857(
      REF_POINTS_9,
      tileCorners,
      this.descriptor.projectTo3857,
      this.descriptor.projectTo4326,
    );

    const commonSpacePositions = refPointsEPSG3857.map((xy) =>
      rescaleEPSG3857ToCommonSpace(xy),
    );

    const refPointPositions: [number, number, number][] = [];
    for (const p of commonSpacePositions) {
      refPointPositions.push([p[0], p[1], minZ]);

      if (minZ !== maxZ) {
        // Also sample at maximum elevation to capture the full 3D volume
        refPointPositions.push([p[0], p[1], maxZ]);
      }
    }

    // Compute [minx, miny, maxx, maxy] in common space for quick bounds check
    // TODO: this doesn't densify edges
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const [x, y] of commonSpacePositions) {
      if (x < minX) {
        minX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y > maxY) {
        maxY = y;
      }
    }

    const commonSpaceBounds: Bounds = [minX, minY, maxX, maxY];
    return {
      boundingVolume: makeOrientedBoundingBoxFromPoints(refPointPositions),
      commonSpaceBounds,
    };
  }
}

/**
 * Wrap a forward projection to EPSG:3857 so that it never returns NaN.
 *
 * proj4 returns [NaN, NaN] for points at the poles (lat = ±90°) because the
 * Mercator projection is undefined there. The wrapper falls back to:
 *   1. Project the input to WGS84 via `projectTo4326`
 *   2. Clamp the latitude to the Web Mercator limit (±85.05°)
 *   3. Convert analytically from WGS84 to EPSG:3857
 *
 * This correctly handles any input CRS, not just EPSG:4326.
 *
 * NOTE: An identical copy of this function lives in
 * `packages/deck.gl-geotiff/src/proj.ts` as `makeClampedForwardTo3857`.
 * The two packages cannot share code due to their dependency relationship
 * (deck.gl-geotiff depends on deck.gl-raster, not vice versa). If this logic
 * changes, update both copies.
 *
 * Perhaps in the future we'll make a `@developmentseed/projections` package to
 * hold shared projection utilities like this.
 */
function makeClampedForwardTo3857(
  projectTo3857: ProjectionFunction,
  projectTo4326: ProjectionFunction,
): ProjectionFunction {
  return (x: number, y: number): [number, number] => {
    const [px, py] = projectTo3857(x, y);
    if (Number.isFinite(px) && Number.isFinite(py)) {
      return [px, py];
    }
    const [lon, lat] = projectTo4326(x, y);
    const clampedLat = Math.max(
      -MAX_WEB_MERCATOR_LAT,
      Math.min(MAX_WEB_MERCATOR_LAT, lat),
    );
    const latRad = (clampedLat * Math.PI) / 180;
    const x3857 = (lon * Math.PI * WGS84_ELLIPSOID_A) / 180;
    const y3857 =
      Math.log(Math.tan(Math.PI / 4 + latRad / 2)) * WGS84_ELLIPSOID_A;
    return [x3857, y3857];
  };
}

/**
 * Sample the selected reference points in EPSG:3857.
 *
 * Reference points are given as `[relX, relY]` fractions in `[0, 1]` and are
 * bilinearly interpolated across the tile's four CRS corners. For axis-aligned
 * tiles this is equivalent to the old AABB lerp; for rotated tiles it correctly
 * samples the actual quadrilateral rather than its bounding box.
 *
 * Note that EPSG:3857 is **not** the same as deck.gl's common space — deck.gl's
 * common space is 512 units wide, while EPSG:3857 uses meters.
 *
 * @param refPoints  Reference points as `[relX, relY]` fractions in `[0, 1]`.
 * @param tileCorners  The four CRS corners of the tile.
 */
function sampleReferencePointsInEPSG3857(
  refPoints: [number, number][],
  tileCorners: Corners,
  projectTo3857: ProjectionFunction,
  projectTo4326: ProjectionFunction,
): [number, number][] {
  const { topLeft, topRight, bottomLeft, bottomRight } = tileCorners;
  const clampedProjectTo3857 = makeClampedForwardTo3857(
    projectTo3857,
    projectTo4326,
  );
  const refPointPositions: [number, number][] = [];

  for (const [relX, relY] of refPoints) {
    const [geoX, geoY] = bilerpPoint(
      topLeft,
      topRight,
      bottomLeft,
      bottomRight,
      relX,
      relY,
    );
    refPointPositions.push(clampedProjectTo3857(geoX, geoY));
  }

  return refPointPositions;
}

/**
 * Rescale positions from EPSG:3857 into deck.gl's common space
 *
 * Similar to the upstream code here:
 * https://github.com/visgl/deck.gl/blob/b0134f025148b52b91320d16768ab5d14a745328/modules/geo-layers/src/tileset-2d/tile-2d-traversal.ts#L172-L177
 */
export function rescaleEPSG3857ToCommonSpace([x, y]: [number, number]): [
  number,
  number,
] {
  // Clamp Y to Web Mercator bounds
  const clampedY = Math.max(
    -EPSG_3857_HALF_CIRCUMFERENCE,
    Math.min(EPSG_3857_HALF_CIRCUMFERENCE, y),
  );

  return [
    (x / EPSG_3857_CIRCUMFERENCE + 0.5) * TILE_SIZE,
    (clampedY / EPSG_3857_CIRCUMFERENCE + 0.5) * TILE_SIZE,
  ];
}

/**
 * Inverse of {@link rescaleEPSG3857ToCommonSpace}: rescale a deck.gl
 * common-space position back into EPSG:3857 meters.
 *
 * Common-space inputs are in-range by construction, so (unlike the forward
 * direction) no latitude clamp is applied.
 */
export function rescaleCommonSpaceToEPSG3857([x, y]: [number, number]): [
  number,
  number,
] {
  return [
    (x / TILE_SIZE - 0.5) * EPSG_3857_CIRCUMFERENCE,
    (y / TILE_SIZE - 0.5) * EPSG_3857_CIRCUMFERENCE,
  ];
}

/**
 * Above this root-tile count, `createRootTiles` culls to the viewport
 * before instantiation. Below it, every root tile is created and downstream
 * frustum culling filters the unused ones. Typical OGC pyramids have 1–a
 * few dozen tiles at z=0, so they stay on the unchanged path. Large
 * single-level zarr descriptors (e.g. AEF mosaic: ~15000 × 7000 ≈ 100M root
 * tiles) must take the culled path or instantiation hangs the page.
 */
const MAX_ROOT_TILES_NO_CULL = 100;

/**
 * Build the list of root (z=0) `RasterTileNode`s for the traversal.
 *
 * Small root matrices (≤ {@link MAX_ROOT_TILES_NO_CULL}) are enumerated
 * directly — traditional pyramids with a 1×1 or 4×5 root grid skip any
 * projection work and keep bit-identical behavior to the pre-optimization
 * traversal.
 *
 * Large root matrices are culled to the intersection of the dataset extent
 * (`datasetWgs84Bounds`) and the viewport's WGS84 bounds, projected into
 * the source CRS via `transformBounds` (which densifies the edges so a
 * curving projection doesn't escape the 4-corner hull). If the viewport
 * and dataset don't overlap, an empty array is returned and the rest of
 * the traversal short-circuits.
 *
 * Exported for unit testing.
 */
export function createRootTiles(opts: {
  descriptor: RasterTilesetDescriptor;
  viewport: Pick<Viewport, "getBounds">;
  datasetWgs84Bounds: Bounds;
}): RasterTileNode[] {
  const { descriptor, viewport, datasetWgs84Bounds } = opts;
  const rootLevel = descriptor.levels[0]!;

  const roots: RasterTileNode[] = [];
  const rootTileCount = rootLevel.matrixWidth * rootLevel.matrixHeight;

  if (rootTileCount <= MAX_ROOT_TILES_NO_CULL) {
    // Small root matrix → enumerate every tile; downstream frustum culling
    // handles the small amount of waste.
    for (let y = 0; y < rootLevel.matrixHeight; y++) {
      for (let x = 0; x < rootLevel.matrixWidth; x++) {
        roots.push(new RasterTileNode(x, y, 0, { descriptor }));
      }
    }
    return roots;
  }

  // Large root matrix → intersect dataset extent with viewport, project
  // to source CRS, use the root level's tile-range helper.
  const vpBounds = viewport.getBounds();
  const cullBounds: Bounds = [
    Math.max(datasetWgs84Bounds[0], vpBounds[0]),
    Math.max(datasetWgs84Bounds[1], vpBounds[1]),
    Math.min(datasetWgs84Bounds[2], vpBounds[2]),
    Math.min(datasetWgs84Bounds[3], vpBounds[3]),
  ];
  if (cullBounds[0] > cullBounds[2] || cullBounds[1] > cullBounds[3]) {
    return roots;
  }
  const [minX, minY, maxX, maxY] = transformBounds(
    descriptor.projectFrom4326,
    cullBounds[0],
    cullBounds[1],
    cullBounds[2],
    cullBounds[3],
  );
  const rootRange = rootLevel.crsBoundsToTileRange(minX, minY, maxX, maxY);
  for (let y = rootRange.minRow; y <= rootRange.maxRow; y++) {
    for (let x = rootRange.minCol; x <= rootRange.maxCol; x++) {
      roots.push(new RasterTileNode(x, y, 0, { descriptor }));
    }
  }
  return roots;
}

/**
 * Get tile indices visible in viewport.
 *
 * Uses frustum culling driven by a {@link RasterTilesetDescriptor}, which abstracts
 * over OGC TileMatrixSet grids and Zarr multiscale pyramids.
 *
 * Overview levels follow the descriptor ordering: index 0 = coarsest, higher = finer.
 */
export function getTileIndices(
  descriptor: RasterTilesetDescriptor,
  opts: {
    viewport: Viewport;
    maxZ: number;
    zRange: ZRange | null;
    wgs84Bounds: Bounds;
    /**
     * Device pixels per CSS pixel for the LOD criterion. Defaults to 1
     * (CSS-pixel-accurate selection). Pass deck.gl's
     * `device.canvasContext.cssToDeviceRatio()` for device-pixel accuracy
     * on HiDPI displays. See `dev-docs/lod-and-pixel-matching.md` § (A).
     */
    pixelRatio?: number;
    /**
     * Cache for tile bounding volumes, reused across `getTileIndices` calls so
     * repeated traversals (animation frames) don't redo the proj4 reprojections
     * + oriented-bounding-box fit. Pass the {@link BoundingVolumeCache} owned by
     * the `RasterTileset2D`. If omitted, a throwaway cache is used — it still
     * dedups within a single traversal but provides no cross-call benefit.
     */
    boundingVolumeCache?: BoundingVolumeCache;
  },
): TileIndex[] {
  const { viewport, maxZ, zRange, wgs84Bounds, pixelRatio = 1 } = opts;

  // Shared by every node in this traversal (the recursion threads it through
  // `update`'s params). A throwaway one is fine — it still dedups within the
  // traversal; only a caller-provided cache survives to the next call.
  const boundingVolumeCache =
    opts.boundingVolumeCache ?? new BoundingVolumeCache();

  // Trim the cache (no-op when under cap) before the traversal — never during,
  // so this frame can never evict an entry it will need again this frame.
  boundingVolumeCache.sweep();

  // Only define `project` function for Globe viewports, same as upstream
  const project: ((xyz: number[]) => number[]) | null =
    viewport instanceof _GlobeViewport && viewport.resolution
      ? viewport.projectPosition
      : null;

  // Get the culling volume of the current camera
  // Same as upstream code
  const planes: Plane[] = Object.values(viewport.getFrustumPlanes()).map(
    ({ normal, distance }) => new Plane(normal.clone().negate(), distance),
  );
  const cullingVolume = new CullingVolume(planes);

  // Project zRange from meters to common space
  const unitsPerMeter = viewport.distanceScales.unitsPerMeter[2]!;
  const elevationMin = (zRange && zRange[0] * unitsPerMeter) || 0;
  const elevationMax = (zRange && zRange[1] * unitsPerMeter) || 0;

  // Upstream deck.gl had a pitch-based optimization here, that took a long time
  // to debug and understand why it doesn't apply for our use case.
  //
  // Their code was:
  //
  // ```ts
  // const minZ =
  //   viewport instanceof WebMercatorViewport && viewport.pitch <= 60 ? maxZ : 0;
  // ```
  //
  // Which can be understood as:
  //
  // > Optimization: For low-pitch views, only consider tiles at maxZ level
  // > At low pitch (top-down view), all tiles are roughly the same distance,
  // > so we don't need the LOD pyramid - just use the finest level
  //
  // > `minZ` is the lowest zoom level where LOD adjustment is allowed
  // > Below `minZ`, tiles skip the distance-based LOD test entirely
  //
  // However, this relies on a very specific assumption: In Web Mercator, OSM
  // tiles already match screen resolution at a given zoom.
  //
  // In our case we want LOD to be evaluated at **all** levels, so we set the
  // minZ to 0
  const minZ = 0;

  const [minLng, minLat, maxLng, maxLat] = wgs84Bounds;
  const bottomLeft = lngLatToWorld([minLng, minLat]);
  const topRight = lngLatToWorld([maxLng, maxLat]);
  const bounds: Bounds = [
    bottomLeft[0],
    bottomLeft[1],
    topRight[0],
    topRight[1],
  ];

  const roots = createRootTiles({
    descriptor,
    viewport,
    datasetWgs84Bounds: wgs84Bounds,
  });

  // Traverse and update visibility
  const traversalParams = {
    viewport,
    project,
    cullingVolume,
    elevationBounds: [elevationMin, elevationMax] as ZRange,
    minZ,
    maxZ,
    bounds,
    pixelRatio,
    boundingVolumeCache,
  };

  for (const root of roots) {
    root.update(traversalParams);
  }

  // World-copy passes: when the viewport spans multiple world copies (e.g.
  // WebMercatorViewport with repeat: true panned across the antimeridian),
  // re-run the traversal with the tile bounding volumes shifted by ±1, ±2…
  // world copies along common-space X. A tile is selected if any pass selects
  // it. See dev-docs/world-copies.md.
  const subViewportCount = viewport.subViewports?.length ?? 0;
  if (subViewportCount > 1) {
    for (let offset = -1; offset >= -MAX_MAPS; offset--) {
      if (!runOffsetPass(roots, traversalParams, offset)) {
        break;
      }
    }
    for (let offset = 1; offset <= MAX_MAPS; offset++) {
      if (!runOffsetPass(roots, traversalParams, offset)) {
        break;
      }
    }
  }

  // Collect selected tiles
  const selectedNodes: RasterTileNode[] = [];
  for (const root of roots) {
    root.getSelected(selectedNodes);
  }

  return selectedNodes;
}

/**
 * Run a non-zero world-offset traversal pass over each root.
 *
 * Returns `true` if any root tile was visible at this offset, signaling the
 * caller to walk further from the primary world. Returns `false` when no
 * tiles were visible — the offset has gone past the visible range and the
 * caller stops walking that side.
 */
function runOffsetPass(
  roots: RasterTileNode[],
  baseParams: Parameters<RasterTileNode["update"]>[0],
  worldOffset: number,
): boolean {
  let anyVisible = false;
  for (const root of roots) {
    if (root.update({ ...baseParams, worldOffset })) {
      anyVisible = true;
    }
  }
  return anyVisible;
}

/**
 * Compute the meters per pixel at a given latitude and zoom level.
 *
 * Taken from https://github.com/visgl/deck.gl/blob/b0134f025148b52b91320d16768ab5d14a745328/modules/widgets/src/scale-widget.tsx#L133C1-L144C1
 *
 * @param latitude - The current latitude.
 * @param zoom - The current zoom level.
 * @returns The number of meters per pixel.
 */
function getMetersPerPixel(latitude: number, zoom: number): number {
  const earthCircumference = 40075016.686;
  return (
    (earthCircumference * Math.cos((latitude * Math.PI) / 180)) /
    2 ** (zoom + 8)
  );
}

function getMetersPerPixelAtBoundingVolume(
  boundingVolume: OrientedBoundingBox,
  zoom: number,
): number {
  const [_lng, lat] = worldToLngLat(boundingVolume.center);
  return getMetersPerPixel(lat, zoom);
}

/**
 * Translate a tile's bounding volume by `dx` units along common-space X.
 *
 * Returns a fresh OBB and AABB; does not mutate the input. Used by the
 * world-copy traversal to test the same tile at multiple shifted positions
 * without recomputing the underlying geometry.
 */
function translateBoundingVolume(
  base: { boundingVolume: OrientedBoundingBox; commonSpaceBounds: Bounds },
  dx: number,
): { boundingVolume: OrientedBoundingBox; commonSpaceBounds: Bounds } {
  const { boundingVolume, commonSpaceBounds } = base;
  const center = boundingVolume.center;
  const translatedCenter = new Vector3(
    (center[0] ?? 0) + dx,
    center[1] ?? 0,
    center[2] ?? 0,
  );
  const translated = new OrientedBoundingBox(
    translatedCenter,
    boundingVolume.halfAxes,
  );
  // `update()`'s bounds check always re-reads the offset-0 `commonSpaceBounds`,
  // so this translated AABB isn't consumed in production — it's kept for API
  // symmetry with `boundingVolume` and is asserted directly by unit tests.
  const translatedBounds: Bounds = [
    commonSpaceBounds[0] + dx,
    commonSpaceBounds[1],
    commonSpaceBounds[2] + dx,
    commonSpaceBounds[3],
  ];
  return {
    boundingVolume: translated,
    commonSpaceBounds: translatedBounds,
  };
}

/**
 * Compute the axis-aligned bounding box of a rotated tile rectangle.
 */
function cornersToBounds({
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
}: Corners): Bounds {
  const xs = [topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]];
  const ys = [topLeft[1], topRight[1], bottomLeft[1], bottomRight[1]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Bilinearly interpolate a 2D point over a unit square.
 *
 * Given four corner points of a quadrilateral, this evaluates the bilinear
 * interpolation at normalized coordinates `(x, y)` ∈ [0, 1]². The mapping is:
 *
 *   p(x, y) =
 *     p00 * (1 - x) * (1 - y) +
 *     p10 * x       * (1 - y) +
 *     p01 * (1 - x) * y       +
 *     p11 * x       * y
 *
 * where:
 *   - `p00` corresponds to (x=0, y=0) (top-left)
 *   - `p10` corresponds to (x=1, y=0) (top-right)
 *   - `p01` corresponds to (x=0, y=1) (bottom-left)
 *   - `p11` corresponds to (x=1, y=1) (bottom-right)
 *
 * This performs interpolation in Euclidean space (component-wise on x/y),
 * producing a bilinear mapping from the unit square to the quadrilateral
 * defined by the four input points.
 *
 * @param p00 - Point at (0, 0), typically top-left.
 * @param p10 - Point at (1, 0), typically top-right.
 * @param p01 - Point at (0, 1), typically bottom-left.
 * @param p11 - Point at (1, 1), typically bottom-right.
 * @param x - Normalized horizontal coordinate in [0, 1].
 * @param y - Normalized vertical coordinate in [0, 1].
 * @returns Interpolated 2D point `[x, y]`.
 *
 * @remarks
 * - Reduces to linear interpolation along edges when `x = 0/1` or `y = 0/1`.
 * - Produces an affine mapping only if the four points form a parallelogram;
 *   otherwise the interior mapping is bilinear (not affine).
 * - No CRS or geodesic behavior is implied; inputs are treated as Cartesian
 *   coordinates.
 */
function bilerpPoint(
  p00: Point,
  p10: Point,
  p01: Point,
  p11: Point,
  x: number,
  y: number,
): [number, number] {
  const w00 = (1 - x) * (1 - y);
  const w10 = x * (1 - y);
  const w01 = (1 - x) * y;
  const w11 = x * y;

  return [
    p00[0] * w00 + p10[0] * w10 + p01[0] * w01 + p11[0] * w11,
    p00[1] * w00 + p10[1] * w10 + p01[1] * w01 + p11[1] * w11,
  ];
}
