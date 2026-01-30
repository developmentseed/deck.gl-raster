/**
 * Convert Zarr multiscale metadata to OGC TileMatrixSet.
 *
 * Handles level ordering (coarsest-first for TMS) and geotransform computation
 * for various Zarr multiscale formats.
 */

import type {
  Bounds,
  FormatDescriptor,
  ZarrLevelMetadata,
  ZarrMultiscaleMetadata,
} from "zarr-multiscale-metadata";
import { STANDARD_CRS } from "zarr-multiscale-metadata";
import type {
  TileMatrix,
  TileMatrixSet,
  TileMatrixSetBoundingBox,
} from "@developmentseed/deck.gl-raster";
import proj4 from "proj4";
import Ellipsoid from "./ellipsoids.js";
import { parseCrs } from "./zarr-reprojection.js";
import type {
  ParseZarrTileMatrixSetOptions,
  ProjectionInfo,
  SortedLevel,
  SupportedCrsUnit,
  ZarrTileMatrixSetResult,
} from "./types.js";

// 0.28 mm per pixel (OGC standard)
// https://docs.ogc.org/is/17-083r4/17-083r4.html#toc15
const SCREEN_PIXEL_SIZE = 0.00028;

/**
 * Normalize longitude bounds from 0-360° convention to -180/180° convention.
 *
 * Many climate/ocean datasets (e.g., ERA5, CMIP6) use 0-360° longitude.
 * Web maps expect -180/180°, so we normalize when bounds exceed 180°.
 *
 * @param bounds [xMin, yMin, xMax, yMax]
 * @param isGeographic Whether the CRS uses geographic coordinates (degrees)
 * @returns Normalized bounds
 */
function normalizeLongitudeBounds(
  bounds: Bounds,
  isGeographic: boolean,
): Bounds {
  if (!isGeographic) {
    return bounds;
  }

  const [xMin, yMin, xMax, yMax] = bounds;

  // Check if bounds are in 0-360 convention (xMax > 180 indicates this)
  if (xMax <= 180) {
    // Already in -180/180 convention
    return bounds;
  }

  // We're in 0-360 convention, convert to -180/180 when we can do so
  // without introducing a wrapped (xMax < xMin) extent.
  const width = xMax - xMin;

  // Case 1: Full global extent (360° or close to it)
  // [0, 360] or [0.5, 359.5] etc. should become [-180, 180]
  if (width >= 359) {
    return [-180, yMin, 180, yMax];
  }

  // Case 2: Entirely in the 180-360 range, shift both ends into -180/180
  if (xMin >= 180) {
    return [xMin - 360, yMin, xMax - 360, yMax];
  }

  // Case 3: Bounds straddle the antimeridian in 0-360 convention.
  // Converting only xMax would flip the range (xMax < xMin) and collapse width.
  // Keep the 0-360 bounds to preserve a positive extent.
  if (xMin >= 0 && xMin < 180 && xMax > 180 && xMax <= 360) {
    return bounds;
  }

  // Fallback: return as-is if we can't safely normalize.
  return bounds;
}

/**
 * Parse Zarr metadata into a TileMatrixSet.
 *
 * @param metadata ZarrMultiscaleMetadata from zarr-multiscale-metadata
 * @param bounds Spatial bounds in CRS units [xMin, yMin, xMax, yMax]
 * @param latIsAscending Whether latitude values are ascending (row 0 = south)
 * @param formatDescriptor FormatDescriptor with CRS info
 * @param options Optional CRS overrides
 */
export async function parseZarrTileMatrixSet(
  metadata: ZarrMultiscaleMetadata,
  bounds: Bounds,
  latIsAscending: boolean,
  formatDescriptor: FormatDescriptor,
  options?: ParseZarrTileMatrixSetOptions,
): Promise<ZarrTileMatrixSetResult> {
  // Resolve CRS - user override takes precedence over formatDescriptor
  const projectionInfo = await getProjectionInfo(formatDescriptor, options?.crs);

  // Normalize longitude bounds if using geographic coordinates
  const isGeographic = projectionInfo.coordinatesUnits === "degree";
  bounds = normalizeLongitudeBounds(bounds, isGeographic);

  // Sort levels by resolution (coarsest first for TMS)
  const sortedLevels = sortLevelsByResolution(metadata.levels);

  // Find the finest level (last in sorted array, has smallest scale factor)
  // and compute base resolution from it
  const finestLevel = sortedLevels[sortedLevels.length - 1]!;
  const finestShape = finestLevel.level.shape;
  const xDimIndex = metadata.base.spatialDimIndices.x ?? finestShape.length - 1;
  const yDimIndex = metadata.base.spatialDimIndices.y ?? finestShape.length - 2;
  const finestWidth = finestShape[xDimIndex]!;
  const finestHeight = finestShape[yDimIndex]!;
  const [xMin, yMin, xMax, yMax] = bounds;
  const baseResolution: [number, number] = [
    (xMax - xMin) / finestWidth,
    (yMax - yMin) / finestHeight,
  ];

  // Create tile matrices
  const tileMatrices: TileMatrix[] = sortedLevels.map((sortedLevel, index) => {
    return createTileMatrix(
      sortedLevel,
      index,
      bounds,
      latIsAscending,
      metadata.base.spatialDimIndices,
      projectionInfo,
      baseResolution,
      metadata.tileSize,
    );
  });

  // Create projection converters using full proj4 definitions
  const wgs84Def = STANDARD_CRS["EPSG:4326"]!.def;
  const mercatorDef = STANDARD_CRS["EPSG:3857"]!.def;
  const projectToWgs84 = proj4(projectionInfo.def, wgs84Def).forward;
  const projectTo3857 = proj4(projectionInfo.def, mercatorDef).forward;

  const boundingBox: TileMatrixSetBoundingBox = {
    lowerLeft: [bounds[0], bounds[1]],
    upperRight: [bounds[2], bounds[3]],
  };

  const wgsBounds = computeWgs84BoundingBox(boundingBox, projectToWgs84);

  const tileMatrixSet: TileMatrixSet = {
    crs: projectionInfo,
    boundingBox,
    wgsBounds,
    tileMatrices,
    projectToWgs84,
    projectTo3857,
  };

  return {
    tileMatrixSet,
    sortedLevels,
  };
}

/**
 * Get projection info from FormatDescriptor.
 *
 * Priority:
 * 1. User CRS override - resolve via standard defs or epsg.io
 * 2. FormatDescriptor.crs.def (already includes standard CRS defs + CF grid_mapping)
 * 3. FormatDescriptor.crs.code - resolve via standard defs or epsg.io
 */
async function getProjectionInfo(
  formatDescriptor: FormatDescriptor,
  userCrsOverride?: string,
): Promise<ProjectionInfo> {
  // User override takes highest priority
  if (userCrsOverride) {
    return resolveCrsToProjectionInfo(userCrsOverride);
  }

  // FormatDescriptor already has def for standard CRS + CF grid_mapping
  if (formatDescriptor.crs.def) {
    const parsed = parseCrs(formatDescriptor.crs.def);
    return {
      def: formatDescriptor.crs.def,
      parsed,
      coordinatesUnits: (parsed.units || "degree") as SupportedCrsUnit,
      code: formatDescriptor.crs.code,
    };
  }

  // Fallback: resolve from formatDescriptor CRS code
  return resolveCrsToProjectionInfo(formatDescriptor.crs.code);
}

/**
 * Resolve a CRS code or proj4 string to ProjectionInfo.
 *
 * The code field is automatically derived for standard CRS and EPSG codes.
 * For raw proj4 strings, code will be undefined.
 */
async function resolveCrsToProjectionInfo(crs: string): Promise<ProjectionInfo> {
  // Check standard CRS definitions first
  const standard = STANDARD_CRS[crs.toUpperCase()];
  if (standard) {
    const parsed = parseCrs(standard.def);
    return {
      def: standard.def,
      parsed,
      coordinatesUnits: standard.units as SupportedCrsUnit,
      code: crs.toUpperCase(),
    };
  }

  // Try to fetch from epsg.io for EPSG codes
  if (crs.startsWith("EPSG:")) {
    const epsgCode = crs.replace("EPSG:", "");
    try {
      const response = await fetch(`https://epsg.io/${epsgCode}.proj4`);
      if (response.ok) {
        const def = await response.text();
        const parsed = parseCrs(def);
        return {
          def,
          parsed,
          coordinatesUnits: (parsed.units || "degree") as SupportedCrsUnit,
          code: crs.toUpperCase(),
        };
      }
    } catch {
      // Fall through to error
    }
    throw new Error(
      `Could not resolve CRS definition for ${crs}. Please provide a proj4def.`,
    );
  }

  // Assume it's already a proj4 string - no code available
  const parsed = parseCrs(crs);
  return {
    def: crs,
    parsed,
    coordinatesUnits: (parsed.units || "degree") as SupportedCrsUnit,
    code: undefined,
  };
}

/**
 * Sort levels by resolution (coarsest/largest resolution first).
 *
 * For formats like ndpyramid-tiled that use placeholder resolution values [1.0, 1.0],
 * we fall back to sorting by pixel count (smaller = coarser = first).
 */
function sortLevelsByResolution(
  levels: ZarrLevelMetadata[],
): SortedLevel[] {
  // Check if all levels have the same (placeholder) resolution
  const firstRes = levels[0]?.resolution;
  const allSameResolution = firstRes && levels.every(
    (level) =>
      level.resolution[0] === firstRes[0] &&
      level.resolution[1] === firstRes[1]
  );

  // Create sorted array with computed sort key
  const indexed = levels.map((level) => {
    // Compute pixel count from shape (use last two dimensions as spatial)
    const shape = level.shape;
    const pixelCount = shape.length >= 2
      ? shape[shape.length - 1]! * shape[shape.length - 2]!
      : 0;

    return {
      level,
      maxResolution: Math.max(level.resolution[0], level.resolution[1]),
      pixelCount,
    };
  });

  if (allSameResolution && indexed.some((item) => item.pixelCount > 0)) {
    // Sort by pixel count ascending (smaller/coarser first)
    indexed.sort((a, b) => a.pixelCount - b.pixelCount);
  } else {
    // Sort by resolution descending (largest/coarsest first)
    indexed.sort((a, b) => b.maxResolution - a.maxResolution);
  }

  // Map to SortedLevel with TMS index
  return indexed.map((item, tmsIndex) => ({
    tmsIndex,
    zarrPath: item.level.path,
    resolution: item.level.resolution,
    level: item.level,
  }));
}

/**
 * Create a TileMatrix for a single level.
 */
function createTileMatrix(
  sortedLevel: SortedLevel,
  tmsIndex: number,
  bounds: Bounds,
  latIsAscending: boolean,
  spatialDimIndices: { x: number | null; y: number | null },
  projectionInfo: ProjectionInfo,
  baseResolution: [number, number], // Base level resolution [xRes, yRes]
  tileSize?: number,
): TileMatrix {
  const { level } = sortedLevel;
  const shape = level.shape;
  const chunks = level.chunks;

  // Get spatial dimensions
  const xDimIndex = spatialDimIndices.x ?? shape.length - 1;
  const yDimIndex = spatialDimIndices.y ?? shape.length - 2;
  const width = shape[xDimIndex]!;
  const height = shape[yDimIndex]!;

  // Use chunk size or tileSize as tile dimensions
  const tileWidth = tileSize ?? chunks[xDimIndex] ?? 256;
  const tileHeight = tileSize ?? chunks[yDimIndex] ?? 256;

  // Always compute geotransform from authoritative bounds
  // This ensures consistent pointOfOrigin across all levels, which is required
  // for correct tile traversal in getOverlappingChildRange()
  // (Using per-level spatialTransform would cause inconsistent origins due to
  // rounding errors accumulated during pyramid generation)
  let geotransform: [number, number, number, number, number, number];

  // Compute geotransform from bounds (edge-based model)
  // pixel 0 → xMin, pixel width → xMax
  const [xMin, yMin, , yMax] = bounds;

  const boundsWidth = bounds[2] - bounds[0];
  const boundsHeight = bounds[3] - bounds[1];

  // Calculate separate scale factors for X and Y
  // This handles Zarr pyramids where dimensions don't scale proportionally
  // (e.g., 262913/1024 = 256.75 → 256 due to rounding in pyramid generation)
  const finestWidth = boundsWidth / baseResolution[0];
  const finestHeight = boundsHeight / baseResolution[1];
  const xScale = finestWidth / width;
  const yScale = finestHeight / height;

  // Each dimension uses its own scale factor
  const xRes = baseResolution[0] * xScale;
  const yRes = baseResolution[1] * yScale;

  const cellSize = Math.abs(xRes);

  // Compute geotransform (edge-based)
  // x_geo = xRes * col + xMin
  // y_geo = ±yRes * row + yOrigin
  if (latIsAscending) {
    // Row 0 = south
    geotransform = [xRes, 0, xMin, 0, yRes, yMin];
  } else {
    // Row 0 = north (standard image convention)
    geotransform = [xRes, 0, xMin, 0, -yRes, yMax];
  }

  const mWidth = Math.ceil(width / tileWidth);
  const mHeight = Math.ceil(height / tileHeight);

  const result = {
    id: String(tmsIndex),
    scaleDenominator: computeScaleDenominator(cellSize, projectionInfo),
    cellSize,
    pointOfOrigin: [geotransform[2], geotransform[5]] as [number, number],
    tileWidth,
    tileHeight,
    matrixWidth: mWidth,
    matrixHeight: mHeight,
    geotransform,
  };
  return result;
}

/**
 * Compute OGC scale denominator.
 *
 * scaleDenominator = (cellSize * metersPerUnit) / 0.00028
 */
function computeScaleDenominator(
  cellSize: number,
  projectionInfo: ProjectionInfo,
): number {
  const mpu = metersPerUnit(projectionInfo);
  return (cellSize * mpu) / SCREEN_PIXEL_SIZE;
}

/**
 * Get meters per unit for the CRS.
 */
function metersPerUnit(projectionInfo: ProjectionInfo): number {
  const unit = projectionInfo.coordinatesUnits;

  switch (unit) {
    case "m":
    case "metre":
    case "meter":
    case "meters":
      return 1;
    case "foot":
      return 0.3048;
    case "US survey foot":
      return 1200 / 3937;
  }

  if (unit === "degree") {
    // 2 * π * ellipsoid semi-major-axis / 360
    // Use WGS84 by default
    const a = Ellipsoid.WGS84.a;
    return (2 * Math.PI * a) / 360;
  }

  // Default to meters
  return 1;
}

/**
 * Compute WGS84 bounding box by sampling points along all edges.
 *
 * For curved projections like Lambert Conformal Conic, the corners alone
 * don't capture the full extent. We sample points along each edge to find
 * the true min/max lat/lon values.
 */
function computeWgs84BoundingBox(
  boundingBox: TileMatrixSetBoundingBox,
  projectToWgs84: (point: [number, number]) => [number, number],
): TileMatrixSetBoundingBox {
  const [xMin, yMin] = boundingBox.lowerLeft;
  const [xMax, yMax] = boundingBox.upperRight;

  // Sample points along edges for curved projections
  const SAMPLES = 20;
  const points: [number, number][] = [];

  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;

    // Bottom edge (y = yMin)
    points.push([xMin + t * (xMax - xMin), yMin]);

    // Top edge (y = yMax)
    points.push([xMin + t * (xMax - xMin), yMax]);

    // Left edge (x = xMin)
    points.push([xMin, yMin + t * (yMax - yMin)]);

    // Right edge (x = xMax)
    points.push([xMax, yMin + t * (yMax - yMin)]);
  }

  // Project all points to WGS84
  const projectedPoints = points.map(projectToWgs84);

  // Find min/max from all projected points
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of projectedPoints) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return {
    lowerLeft: [minLon, minLat],
    upperRight: [maxLon, maxLat],
  };
}
