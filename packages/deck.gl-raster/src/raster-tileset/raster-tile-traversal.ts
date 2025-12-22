/**
 * This file implements tile traversal for generic 2D tilesets defined by
 * TileMatrixSet tile layouts.
 *
 * The main algorithm works as follows:
 *
 * 1. Start at the root tile(s) (z=0, covers the entire image, but not
 *    necessarily the whole world)
 * 2. Test if each tile is visible using viewport frustum culling
 * 3. For visible tiles, compute distance-based LOD (Level of Detail)
 * 4. If LOD is insufficient, recursively subdivide into 4 child tiles
 * 5. Select tiles at appropriate zoom levels based on distance from camera
 *
 * The result is a set of tiles at varying zoom levels that efficiently
 * cover the visible area with appropriate detail.
 */

import { _GlobeViewport, assert, Viewport } from "@deck.gl/core";
import {
  CullingVolume,
  makeOrientedBoundingBoxFromPoints,
  OrientedBoundingBox,
  Plane,
} from "@math.gl/culling";
import { lngLatToWorld, worldToLngLat } from "@math.gl/web-mercator";

import type {
  TileIndex,
  TileMatrix,
  TileMatrixSet,
  ZRange,
  Bounds,
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

// 0.28 mm per pixel
// https://docs.ogc.org/is/17-083r4/17-083r4.html#toc15
const SCREEN_PIXEL_SIZE = 0.00028;

/**
 * Raster Tile Node - represents a single tile in the TileMatrixSet structure
 *
 * Akin to the upstream OSMNode class.
 *
 * This node class uses the following coordinate system:
 *
 * - x: tile column (0 to TileMatrix.matrixWidth, left to right)
 * - y: tile row (0 to TileMatrix.matrixHeight, top to bottom)
 * - z: overview level. This assumes ordering where: 0 = coarsest, higher = finer
 */
export class RasterTileNode {
  /** Index across a row */
  x: number;

  /** Index down a column */
  y: number;

  /** Zoom index assumed to be (higher = finer detail) */
  z: number;

  private metadata: TileMatrixSet;

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

  constructor(x: number, y: number, z: number, metadata: TileMatrixSet) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.metadata = metadata;
  }

  /** Get overview info for this tile's z level */
  get tileMatrix(): TileMatrix {
    return this.metadata.tileMatrices[this.z]!;
  }

  /** Get the children of this node.
   *
   * Find all tiles at level this.z + 1 whose spatial extent overlaps this tile.
   *
   * A TileMatrixSet is not a quadtree, but rather a stack of independent grids. We can't cleanly find child tiles by decimation directly.
   *
   */
  get children(): RasterTileNode[] | null {
    if (!this._children) {
      const maxZ = this.metadata.tileMatrices.length - 1;
      if (this.z >= maxZ) {
        // Already at finest resolution, no children
        this._children = null;
        return null;
      }

      // In TileMatrixSet ordering: refine to z + 1 (finer detail)
      const parentMatrix = this.tileMatrix;
      const childZ = this.z + 1;
      const childMatrix = this.metadata.tileMatrices[childZ]!;

      // Compute this tile's bounds in TMS' CRS
      const parentBounds = computeProjectedTileBounds({
        x: this.x,
        y: this.y,
        transform: parentMatrix.geotransform,
        tileWidth: parentMatrix.tileWidth,
        tileHeight: parentMatrix.tileHeight,
      });

      // Find overlapping child index range
      const { minCol, maxCol, minRow, maxRow } = getOverlappingChildRange(
        parentBounds,
        childMatrix,
      );

      const children: RasterTileNode[] = [];

      for (let y = minRow; y <= maxRow; y++) {
        for (let x = minCol; x <= maxCol; x++) {
          children.push(new RasterTileNode(x, y, childZ, this.metadata));
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
   * I.e. “Given this tile node, should I render this tile, or should I recurse
   * into its children?”
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
    /** Minimum (coarsest) COG overview level */
    minZ: number;
    /** Maximum (finest) COG overview level */
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
      maxZ = this.metadata.tileMatrices.length - 1,
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
    // “When pitch is low, force selection at maxZ.”
    if (!this.childVisible && this.z >= minZ) {
      const metersPerScreenPixel = getMetersPerPixelAtBoundingVolume(
        boundingVolume,
        viewport.zoom,
      );
      // console.log("metersPerScreenPixel", metersPerScreenPixel);

      const tileMetersPerPixel =
        this.tileMatrix.scaleDenominator * SCREEN_PIXEL_SIZE;

      // console.log("tileMetersPerPixel", tileMetersPerPixel);

      // const screenScaleDenominator = metersPerScreenPixel / SCREEN_PIXEL_SIZE;

      // console.log("screenScaleDenominator", screenScaleDenominator);

      // TODO: in the future we could try adding a bias
      // const LOD_BIAS = 0.75;
      // this.tileMatrix.scaleDenominator <= screenScaleDenominator * LOD_BIAS

      // console.log(
      //   "this.tileMatrix.scaleDenominator",
      //   this.tileMatrix.scaleDenominator,
      // );

      // console.log(
      //   "tileMetersPerPixel <= metersPerScreenPixel",
      //   tileMetersPerPixel <= metersPerScreenPixel,
      // );

      if (
        tileMetersPerPixel <= metersPerScreenPixel ||
        this.z >= maxZ ||
        (children === null && this.z >= minZ)
      ) {
        // “Select this tile when its scale is at least as detailed as the screen.”
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
   * @returns Array of selected OSMNode tiles
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

    // console.log("bounds:", bounds);
    // console.log("tile bounds:", commonSpaceBounds);

    const inside =
      tileMinX < maxX && tileMaxX > minX && tileMinY < maxY && tileMaxY > minY;
    // console.log("insideBounds", inside);
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
    const tileMatrix = this.tileMatrix;
    const { tileWidth, tileHeight, geotransform } = tileMatrix;
    const [minZ, maxZ] = zRange;

    const tileCrsBounds = computeProjectedTileBounds({
      x: this.x,
      y: this.y,
      transform: geotransform,
      tileWidth,
      tileHeight,
    });

    const refPointsEPSG3857 = sampleReferencePointsInEPSG3857(
      REF_POINTS_9,
      tileCrsBounds,
      this.metadata.projectTo3857,
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
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    const commonSpaceBounds: Bounds = [minX, minY, maxX, maxY];
    return {
      boundingVolume: makeOrientedBoundingBoxFromPoints(refPointPositions),
      commonSpaceBounds,
    };
  }
}

/**
 * Compute the projected tile bounds in the tile matrix's CRS.
 *
 * Because it's a linear transformation from the tile index to projected bounds,
 * we don't need to sample this for each of the reference points. We only need
 * the corners.
 *
 * @return      The bounding box as [minX, minY, maxX, maxY] in projected CRS.
 */
function computeProjectedTileBounds({
  x,
  y,
  transform,
  tileWidth,
  tileHeight,
}: {
  x: number;
  y: number;
  transform: [number, number, number, number, number, number];
  tileWidth: number;
  tileHeight: number;
}): [number, number, number, number] {
  // geotransform: [a, b, c, d, e, f] where:
  // x_geo = a * col + b * row + c
  // y_geo = d * col + e * row + f
  const [a, b, c, d, e, f] = transform;

  // Currently only support non-rotated/non-skewed transforms
  if (b !== 0 || d !== 0) {
    throw new Error(
      `Rotated/skewed geotransforms not yet supported (b=${b}, d=${d}). ` +
        `Only north-up, non-rotated rasters are currently supported.`,
    );
  }

  // Calculate pixel coordinates for this tile's extent
  const pixelMinCol = x * tileWidth;
  const pixelMinRow = y * tileHeight;
  const pixelMaxCol = (x + 1) * tileWidth;
  const pixelMaxRow = (y + 1) * tileHeight;

  // Convert pixel coordinates to geographic coordinates using geotransform
  const minX = a * pixelMinCol + b * pixelMinRow + c;
  const minY = d * pixelMinCol + e * pixelMinRow + f;

  const maxX = a * pixelMaxCol + b * pixelMaxRow + c;
  const maxY = d * pixelMaxCol + e * pixelMaxRow + f;

  // Note: often `e` in the geotransform is negative (for a north up image when
  // the origin is in the **top** left, then increasing the pixel row means
  // going down in geospatial space), so maxY < minY
  //
  // We want to always return an axis-aligned bbox in the form of
  // [minX, minY, maxX, maxY], so we need to swap if necessary.
  //
  // For now, we just use Math.min/Math.max to ensure correct ordering, but we
  // could remove the min/max calls if we assume that `a` and `e` are always
  // positive/negative respectively.
  return [
    Math.min(minX, maxX),
    Math.min(minY, maxY),
    Math.max(minX, maxX),
    Math.max(minY, maxY),
  ];
}

/**
 * Sample the selected reference points in EPSG:3857
 *
 * Note that EPSG:3857 is **not** the same as deck.gl's common space! deck.gl's
 * common space is the size of `TILE_SIZE` (512) units, while EPSG:3857 uses
 * meters.
 *
 * @param  refPoints selected reference points. Each coordinate should be in [0-1]
 * @param  tileBounds the bounds of the tile in **tile CRS** [minX, minY, maxX, maxY]
 */
function sampleReferencePointsInEPSG3857(
  refPoints: [number, number][],
  tileBounds: [number, number, number, number],
  projectTo3857: (xy: [number, number]) => [number, number],
): [number, number][] {
  const [minX, minY, maxX, maxY] = tileBounds;
  const refPointPositions: [number, number][] = [];

  for (const [relX, relY] of refPoints) {
    const geoX = minX + relX * (maxX - minX);
    const geoY = minY + relY * (maxY - minY);

    // Reproject to Web Mercator (EPSG 3857)
    const projected = projectTo3857([geoX, geoY]);
    refPointPositions.push(projected);
  }

  return refPointPositions;
}

/**
 * Rescale positions from EPSG:3857 into deck.gl's common space
 *
 * Similar to the upstream code here:
 * https://github.com/visgl/deck.gl/blob/b0134f025148b52b91320d16768ab5d14a745328/modules/geo-layers/src/tileset-2d/tile-2d-traversal.ts#L172-L177
 *
 * @param   {number[]}  xy  [xy description]
 *
 * @return  {number}        [return description]
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
 * Compute the range of tile indices in a child TileMatrix that spatially
 * overlap a parent tile.
 *
 * TileMatrixSets are not guaranteed to form a strict quadtree: successive
 * TileMatrix levels may differ by non-integer refinement ratios and may not
 * align perfectly in tile space. As a result, parent/child relationships
 * cannot be inferred from zoom level or resolution alone.
 *
 * This function determines parent→child relationships by:
 * 1. Treating each TileMatrix as an independent, axis-aligned grid in CRS space
 * 2. Mapping the parent tile's CRS bounding box into the child grid
 * 3. Returning the inclusive range of child tile indices whose spatial extent
 *    intersects the parent tile
 *
 * The returned indices are clamped to the valid extents of the child matrix
 * (`[0, matrixWidth)` and `[0, matrixHeight)`).
 *
 * Assumptions:
 * - The TileMatrix grid is axis-aligned in CRS space
 * - `cornerOfOrigin` is `"topLeft"`
 * - Tiles are rectangular and uniformly sized within a TileMatrix
 *
 * @param parentBounds  Bounding box of the parent tile in CRS coordinates
 *                      as `[minX, minY, maxX, maxY]`
 * @param childMatrix   The TileMatrix definition for the child zoom level
 *
 * @returns An object containing inclusive index ranges:
 *          `{ minCol, maxCol, minRow, maxRow }`, identifying all child tiles
 *          that spatially overlap the parent tile
 */
function getOverlappingChildRange(
  parentBounds: [number, number, number, number],
  childMatrix: TileMatrix,
): {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
} {
  const [pMinX, pMinY, pMaxX, pMaxY] = parentBounds;

  const {
    tileWidth,
    tileHeight,
    cellSize,
    matrixWidth,
    matrixHeight,
    pointOfOrigin,
  } = childMatrix;

  const childTileWidthCRS = tileWidth * cellSize;
  const childTileHeightCRS = tileHeight * cellSize;

  // Note: we assume top left origin
  const originX = pointOfOrigin[0];
  const originY = pointOfOrigin[1];

  // Convert CRS bounds → tile indices
  let minCol = Math.floor((pMinX - originX) / childTileWidthCRS);
  let maxCol = Math.floor((pMaxX - originX) / childTileWidthCRS);

  let minRow = Math.floor((originY - pMaxY) / childTileHeightCRS);
  let maxRow = Math.floor((originY - pMinY) / childTileHeightCRS);

  // Clamp to matrix bounds
  minCol = Math.max(0, Math.min(matrixWidth - 1, minCol));
  maxCol = Math.max(0, Math.min(matrixWidth - 1, maxCol));
  minRow = Math.max(0, Math.min(matrixHeight - 1, minRow));
  maxRow = Math.max(0, Math.min(matrixHeight - 1, maxRow));

  return { minCol, maxCol, minRow, maxRow };
}

/**
 * Get tile indices visible in viewport
 * Uses frustum culling similar to OSM implementation
 *
 * Overviews follow TileMatrixSet ordering: index 0 = coarsest, higher = finer
 */
export function getTileIndices(
  metadata: TileMatrixSet,
  opts: {
    viewport: Viewport;
    maxZ: number;
    zRange: ZRange | null;
  },
): TileIndex[] {
  const { viewport, maxZ, zRange } = opts;

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

  const { lowerLeft, upperRight } = metadata.wgsBounds;
  const [minLng, minLat] = lowerLeft;
  const [maxLng, maxLat] = upperRight;
  const bottomLeft = lngLatToWorld([minLng, minLat]);
  const topRight = lngLatToWorld([maxLng, maxLat]);
  const bounds: Bounds = [
    bottomLeft[0],
    bottomLeft[1],
    topRight[0],
    topRight[1],
  ];

  // Start from coarsest overview
  const rootMatrix = metadata.tileMatrices[0]!;

  // Create root tiles at coarsest level
  // In contrary to OSM tiling, we might have more than one tile at the
  // coarsest level (z=0)
  const roots: RasterTileNode[] = [];
  for (let y = 0; y < rootMatrix.matrixHeight; y++) {
    for (let x = 0; x < rootMatrix.matrixWidth; x++) {
      roots.push(new RasterTileNode(x, y, 0, metadata));
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

  // console.log("traversalParams", traversalParams);
  // console.log("roots", roots);

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
    Math.pow(2, zoom + 8)
  );
}

function getMetersPerPixelAtBoundingVolume(
  boundingVolume: OrientedBoundingBox,
  zoom: number,
): number {
  const [_lng, lat] = worldToLngLat(boundingVolume.center);
  return getMetersPerPixel(lat, zoom);
}

// function getScreenMetersPerPixel(viewport: Viewport, center: Vector3): number {
//   const lng
//   const p0 = viewport.projectPosition(center);
//   const p1 = viewport.projectPosition([
//     centerArray[0]! + 1,
//     centerArray[1]!,
//     centerArray[2]!,
//   ]);

//   const pixelsPerMeter = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
//   return 1 / pixelsPerMeter;
// }

/**
 * Exports only for use in testing
 */
export const __TEST_EXPORTS = {
  computeProjectedTileBounds,
  RasterTileNode,
};
