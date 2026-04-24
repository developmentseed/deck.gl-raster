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
 * The traversal is driven by a {@link TilesetDescriptor}, which abstracts over
 * both OGC TileMatrixSet grids and Zarr multiscale pyramids.
 */

import type { Viewport } from "@deck.gl/core";
import { _GlobeViewport, assert } from "@deck.gl/core";
import type { OrientedBoundingBox } from "@math.gl/culling";
import {
  CullingVolume,
  makeOrientedBoundingBoxFromPoints,
  Plane,
} from "@math.gl/culling";
import { lngLatToWorld, worldToLngLat } from "@math.gl/web-mercator";

import type { TilesetDescriptor, TilesetLevel } from "./tileset-interface.js";
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
 * - x: tile column (0 to TilesetLevel.matrixWidth, left to right)
 * - y: tile row (0 to TilesetLevel.matrixHeight, top to bottom)
 * - z: overview level. This assumes ordering where: 0 = coarsest, higher = finer
 */
export class RasterTileNode {
  /** Index across a row */
  x: number;

  /** Index down a column */
  y: number;

  /** Zoom index assumed to be (higher = finer detail) */
  z: number;

  private descriptor: TilesetDescriptor;

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

  /**
   * A cached bounding volume for this tile, used for frustum culling
   *
   * This stores the result of `getBoundingVolume`.
   */
  private _boundingVolume?: {
    /** The zrange used to compute this bounding volume. */
    zRange: ZRange;
    result: { boundingVolume: OrientedBoundingBox; commonSpaceBounds: Bounds };
  };

  constructor(
    x: number,
    y: number,
    z: number,
    { descriptor }: { descriptor: TilesetDescriptor },
  ) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.descriptor = descriptor;
  }

  /** Get the level info for this tile's z index. */
  get level(): TilesetLevel {
    return this.descriptor.levels[this.z]!;
  }

  /** Get the children of this node.
   *
   * Find all tiles at level this.z + 1 whose spatial extent overlaps this tile.
   *
   * A tileset pyramid is not guaranteed to be a quadtree — it is a stack of
   * independent grids. We find children by mapping the parent tile's CRS bounds
   * into the child grid using {@link TilesetLevel.crsBoundsToTileRange}.
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
  }): boolean {
    // Reset state
    this.childVisible = false;
    this.selected = false;

    const {
      viewport,
      cullingVolume,
      elevationBounds,
      minZ,
      maxZ = this.descriptor.levels.length - 1,
      project,
      bounds,
    } = params;

    // Get bounding volume for this tile
    const { boundingVolume, commonSpaceBounds } = this.getBoundingVolume(
      elevationBounds,
      project,
    );

    // Step 1: Bounds checking
    // If geographic bounds are specified, reject tiles outside those bounds
    if (bounds && !this.insideBounds(bounds, commonSpaceBounds)) {
      return false;
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
      const metersPerScreenPixel = getMetersPerPixelAtBoundingVolume(
        boundingVolume,
        viewport.zoom,
      );

      const tileMetersPerPixel = this.level.metersPerPixel;

      if (
        tileMetersPerPixel <= metersPerScreenPixel ||
        this.z >= maxZ ||
        (children === null && this.z >= minZ)
      ) {
        // "Select this tile when its scale is at least as detailed as the screen."
        this.selected = true;
        return true;
      }
    }

    // LOD is not enough, recursively test child tiles
    //
    // Note that if `this.children` is `null`, then there are no children
    // available because we're already at the finest tile resolution available
    if (children && children.length > 0) {
      this.selected = false;

      let anyChildVisible = false;

      for (const child of children) {
        if (child.update(params)) {
          anyChildVisible = true;
        }
      }

      this.childVisible = anyChildVisible;
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
   * Calculate the 3D bounding volume for this tile in deck.gl's common
   * coordinate space for frustum culling.
   *
   * TODO: In the future, we can add a fast path in the case that the source
   * tiling is already in EPSG:3857.
   */
  getBoundingVolume(
    zRange: ZRange,
    project: ((xyz: number[]) => number[]) | null,
  ): { boundingVolume: OrientedBoundingBox; commonSpaceBounds: Bounds } {
    const cached = this._boundingVolume;
    if (
      cached &&
      cached.zRange[0] === zRange[0] &&
      cached.zRange[1] === zRange[1]
    ) {
      return cached.result;
    }

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
    const result = this._getGenericBoundingVolume(zRange);
    this._boundingVolume = { zRange, result };
    return result;
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
function rescaleEPSG3857ToCommonSpace([x, y]: [number, number]): [
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
 * Find the range of root (z=0) tiles that intersect a WGS84 viewport
 * bounding box.
 *
 * Projects the 4 WGS84 corners into the source CRS, takes the axis-aligned
 * bbox of the projected quad, then asks the root level which of its tiles
 * that bbox covers. Clamped inside `crsBoundsToTileRange`, so a viewport
 * outside the dataset collapses to a single (out-of-frustum) root tile.
 *
 * Exported for unit testing; the production call site is
 * {@link getTileIndices}.
 */
export function getRootTileRange(
  rootLevel: TilesetLevel,
  wgs84Bounds: Bounds,
  descriptor: Pick<TilesetDescriptor, "projectFrom4326">,
): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
  const [minLng, minLat, maxLng, maxLat] = wgs84Bounds;
  const corners: Array<[number, number]> = [
    descriptor.projectFrom4326(minLng, minLat),
    descriptor.projectFrom4326(maxLng, minLat),
    descriptor.projectFrom4326(maxLng, maxLat),
    descriptor.projectFrom4326(minLng, maxLat),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return rootLevel.crsBoundsToTileRange(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  );
}

/**
 * Get tile indices visible in viewport.
 *
 * Uses frustum culling driven by a {@link TilesetDescriptor}, which abstracts
 * over OGC TileMatrixSet grids and Zarr multiscale pyramids.
 *
 * Overview levels follow the descriptor ordering: index 0 = coarsest, higher = finer.
 */
export function getTileIndices(
  descriptor: TilesetDescriptor,
  opts: {
    viewport: Viewport;
    maxZ: number;
    zRange: ZRange | null;
    wgs84Bounds: Bounds;
  },
): TileIndex[] {
  const { viewport, maxZ, zRange, wgs84Bounds } = opts;

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

  // Start from coarsest level
  const rootLevel = descriptor.levels[0]!;

  // Create root tiles at coarsest level.
  // In contrary to OSM tiling, we might have more than one tile at the
  // coarsest level (z=0). For large single-level descriptors (e.g. a global
  // 10 m raster tiled at 256×256 → 15000×7000 root tiles) iterating the full
  // matrix before frustum culling is catastrophic.
  //
  // Cull to the intersection of the dataset extent (`wgs84Bounds`) and the
  // viewport's WGS84 bounds before instantiating. If the two don't overlap,
  // skip traversal entirely.
  const vpBounds = viewport.getBounds();
  const cullBounds: Bounds = [
    Math.max(wgs84Bounds[0], vpBounds[0]),
    Math.max(wgs84Bounds[1], vpBounds[1]),
    Math.min(wgs84Bounds[2], vpBounds[2]),
    Math.min(wgs84Bounds[3], vpBounds[3]),
  ];
  const roots: RasterTileNode[] = [];
  if (cullBounds[0] <= cullBounds[2] && cullBounds[1] <= cullBounds[3]) {
    const rootRange = getRootTileRange(rootLevel, cullBounds, descriptor);
    for (let y = rootRange.minRow; y <= rootRange.maxRow; y++) {
      for (let x = rootRange.minCol; x <= rootRange.maxCol; x++) {
        roots.push(new RasterTileNode(x, y, 0, { descriptor }));
      }
    }
  }

  // Traverse and update visibility
  const traversalParams = {
    viewport,
    project,
    cullingVolume,
    elevationBounds: [elevationMin, elevationMax] as ZRange,
    minZ,
    maxZ,
    bounds,
  };

  for (const root of roots) {
    root.update(traversalParams);
  }

  // Collect selected tiles
  const selectedNodes: RasterTileNode[] = [];
  for (const root of roots) {
    root.getSelected(selectedNodes);
  }

  return selectedNodes;
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
