/**
 * @module dimensions
 *
 * Utilities for identifying spatial dimensions in Zarr arrays.
 */

import { SPATIAL_DIMENSION_ALIASES } from "./constants";
import type {
  DimensionInfo,
  SpatialDimensionOverrides,
  SpatialDimIndices,
} from "./types";

// Pre-computed lowercase alias Sets to avoid repeated allocations
const LOWER_LAT_ALIASES = new Set(
  SPATIAL_DIMENSION_ALIASES.lat.map((a) => a.toLowerCase()),
);
const LOWER_LON_ALIASES = new Set(
  SPATIAL_DIMENSION_ALIASES.lon.map((a) => a.toLowerCase()),
);

/**
 * Identify spatial (lat/lon) dimensions within an array's dimension names.
 *
 * Auto-detects common names (lat, latitude, y, lon, longitude, x, etc.)
 * with optional overrides for non-standard naming.
 *
 * @param dimensions - Array dimension names (e.g., ['time', 'lat', 'lon'])
 * @param overrides - Optional explicit dimension name overrides
 * @returns Object with x and y dimension indices (null if not found)
 */
export function identifySpatialDimensions(
  dimensions: string[],
  overrides?: SpatialDimensionOverrides,
): SpatialDimIndices {
  const result: SpatialDimIndices = { x: null, y: null };

  // Find lat (y) dimension
  for (let i = 0; i < dimensions.length; i++) {
    const name = dimensions[i].toLowerCase();
    const isLat = overrides?.lat
      ? name === overrides.lat.toLowerCase()
      : LOWER_LAT_ALIASES.has(name);
    if (isLat) {
      result.y = i;
      break;
    }
  }

  // Find lon (x) dimension
  for (let i = 0; i < dimensions.length; i++) {
    const name = dimensions[i].toLowerCase();
    const isLon = overrides?.lon
      ? name === overrides.lon.toLowerCase()
      : LOWER_LON_ALIASES.has(name);
    if (isLon) {
      result.x = i;
      break;
    }
  }

  return result;
}

/**
 * Build complete dimension information from array metadata.
 *
 * @param dimensions - Array dimension names
 * @param shape - Array shape
 * @returns Array of DimensionInfo objects
 */
export function buildDimensionInfo(
  dimensions: string[],
  shape: number[],
): DimensionInfo[] {
  return dimensions.map((name, index) => ({
    name,
    index,
    size: shape[index] ?? 0,
  }));
}

/**
 * Check if a dimension name is a known spatial dimension.
 *
 * @param name - Dimension name to check
 * @returns true if the name is a known spatial dimension alias
 */
export function isSpatialDimension(name: string): boolean {
  const lower = name.toLowerCase();
  return LOWER_LAT_ALIASES.has(lower) || LOWER_LON_ALIASES.has(lower);
}

/**
 * Get the canonical spatial dimension key ('lat' or 'lon') for a dimension name.
 *
 * @param name - Dimension name to check
 * @returns 'lat', 'lon', or null if not a spatial dimension
 */
export function getSpatialDimensionKey(name: string): "lat" | "lon" | null {
  const lower = name.toLowerCase();
  if (LOWER_LAT_ALIASES.has(lower)) {
    return "lat";
  }
  if (LOWER_LON_ALIASES.has(lower)) {
    return "lon";
  }
  return null;
}
