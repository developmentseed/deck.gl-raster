/**
 * @module format-descriptor
 *
 * FormatDescriptor provides a pure data representation of format characteristics
 * for use by rendering packages (zarr-layer, deck.gl-raster).
 *
 * This centralizes format detection and CRS resolution, reducing duplicated
 * branching in both rendering packages.
 */

import { getStandardCRS, getTiledBounds } from "./crs-defs";
import type { Bounds, MultiscaleFormat, ZarrMultiscaleMetadata } from "./types";

/**
 * Tile convention for spatial data.
 * - 'slippy': Standard Web Mercator slippy map tiles (z/x/y)
 * - 'equirectangular': Equirectangular (EPSG:4326) tile grid
 * - 'none': Not tiled (continuous raster)
 */
export type TileConvention = "slippy" | "equirectangular" | "none";

/**
 * FormatDescriptor - Pure data describing format characteristics.
 * No rendering logic, fully portable across packages.
 */
export interface FormatDescriptor {
  /**
   * Detected multiscale format.
   */
  format: MultiscaleFormat;

  /**
   * CRS information.
   * code: 'EPSG:4326', 'EPSG:3857', or custom identifier
   * def: proj4 definition string for custom CRS
   */
  crs: {
    code: string;
    def?: string;
  };

  /**
   * Spatial bounds [xMin, yMin, xMax, yMax].
   * null if bounds couldn't be determined.
   */
  bounds: Bounds | null;

  /**
   * CRS of the bounds values.
   * 'source': bounds are in source CRS units (degrees for 4326, meters for 3857)
   * 'wgs84': bounds are always in WGS84 degrees (for projected data)
   */
  boundsCrs: "source" | "wgs84";

  /**
   * Data orientation: true if row 0 = south (latitude ascending).
   * false if row 0 = north (latitude descending).
   * This is the single source of truth - consumers should NOT recompute.
   */
  latIsAscending: boolean;

  /**
   * Tile convention for this format.
   */
  tileConvention: TileConvention;

  /**
   * Tile size in pixels for tiled formats.
   * undefined for non-tiled formats.
   */
  tileSize?: number;
}

/**
 * Determine tile convention from format and CRS.
 */
function determineTileConvention(
  format: MultiscaleFormat,
  crsCode: string | null,
): TileConvention {
  if (format !== "ndpyramid-tiled") {
    return "none";
  }

  // Tiled format - determine slippy vs equirectangular based on CRS
  if (crsCode === "EPSG:4326") {
    return "equirectangular";
  }

  // Default to slippy (Web Mercator) for EPSG:3857 and other CRS
  return "slippy";
}

/**
 * Determine default latIsAscending based on format.
 * - Tiled formats always use row 0 = north (false)
 * - EPSG:3857 untiled typically uses row 0 = north (false)
 * - EPSG:4326 untiled typically uses row 0 = south (true) but can vary
 */
function determineDefaultLatIsAscending(format: MultiscaleFormat): boolean {
  if (format === "ndpyramid-tiled") {
    return false; // Tiled format always uses row 0 = north
  }

  // For untiled formats, default to true (row 0 = south)
  // This matches common scientific data conventions
  // Actual value should come from metadata or coordinate analysis
  return true;
}

/**
 * Create a FormatDescriptor from parsed ZarrMultiscaleMetadata.
 * This is the primary factory function for creating descriptors.
 */
export function createFormatDescriptor(
  metadata: ZarrMultiscaleMetadata,
  options?: {
    /** Explicit proj4 definition for custom CRS */
    proj4def?: string;
    /** Override latIsAscending detection */
    latIsAscending?: boolean;
  },
): FormatDescriptor {
  const format = metadata.format;
  const crsInfo = metadata.crs;
  const crsCode = crsInfo?.code ?? (options?.proj4def ? "custom" : "EPSG:4326");

  // Determine tile convention
  const tileConvention = determineTileConvention(format, crsCode);

  // Validate: equirectangular tiles only valid for EPSG:4326
  if (tileConvention === "equirectangular" && crsCode !== "EPSG:4326") {
    console.warn(
      `[zarr-metadata] Equirectangular tile convention with ${crsCode} is unusual`,
    );
  }

  // Determine latIsAscending
  let latIsAscending: boolean;
  if (options?.latIsAscending !== undefined) {
    latIsAscending = options.latIsAscending;
  } else if (metadata.latIsAscending !== null) {
    latIsAscending = metadata.latIsAscending;
  } else {
    latIsAscending = determineDefaultLatIsAscending(format);
  }

  // Build CRS info
  const crs: FormatDescriptor["crs"] = {
    code: crsCode,
  };

  // Add proj4 definition if provided or available
  if (options?.proj4def) {
    crs.def = options.proj4def;
  } else if (crsInfo?.proj4def) {
    crs.def = crsInfo.proj4def;
  } else {
    // Auto-populate crs.def for standard CRS codes
    const standard = getStandardCRS(crsCode);
    if (standard) {
      crs.def = standard.def;
    }
  }

  // Determine bounds - from metadata or auto-populate for tiled formats
  let bounds = metadata.bounds;
  if (!bounds && format === "ndpyramid-tiled") {
    bounds = getTiledBounds(crsCode) ?? null;
  }

  // Determine bounds CRS
  // If we have a proj4 definition, bounds are typically in the source CRS
  // Otherwise they're in the CRS indicated by crsCode
  const boundsCrs: "source" | "wgs84" = "source";

  const descriptor: FormatDescriptor = {
    format,
    crs,
    bounds,
    boundsCrs,
    latIsAscending,
    tileConvention,
  };

  // Add tile size for tiled formats
  if (format === "ndpyramid-tiled" && metadata.tileSize) {
    descriptor.tileSize = metadata.tileSize;
  }

  return descriptor;
}

/**
 * Create a FormatDescriptor with explicit values.
 * Useful for testing or when constructing descriptors without full metadata.
 */
export function createExplicitFormatDescriptor(
  params: Partial<FormatDescriptor> & {
    format: MultiscaleFormat;
    crs: { code: string; def?: string };
  },
): FormatDescriptor {
  const { format, crs } = params;

  // Determine tile convention if not explicitly provided
  const tileConvention =
    params.tileConvention ?? determineTileConvention(format, crs.code);

  // Determine latIsAscending if not explicitly provided
  const latIsAscending =
    params.latIsAscending ?? determineDefaultLatIsAscending(format);

  return {
    format,
    crs,
    bounds: params.bounds ?? null,
    boundsCrs: params.boundsCrs ?? "source",
    latIsAscending,
    tileConvention,
    tileSize: params.tileSize,
  };
}

/**
 * Type guard to check if descriptor uses tiled rendering.
 */
export function isTiledDescriptor(descriptor: FormatDescriptor): boolean {
  return descriptor.tileConvention !== "none";
}

/**
 * Type guard to check if descriptor requires proj4 reprojection.
 */
export function requiresProj4Reprojection(
  descriptor: FormatDescriptor,
): boolean {
  return !!descriptor.crs.def;
}

/**
 * Check if CRS is a standard Web Mercator or WGS84 CRS.
 */
export function isStandardCrs(descriptor: FormatDescriptor): boolean {
  const code = descriptor.crs.code;
  return code === "EPSG:4326" || code === "EPSG:3857";
}
