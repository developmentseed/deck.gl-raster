/**
 * @module constants
 *
 * Constants used for dimension detection and CRS handling.
 */

/**
 * Common names for spatial dimensions.
 * Matched case-insensitively during dimension identification.
 */
export const SPATIAL_DIMENSION_ALIASES: Record<"lat" | "lon", string[]> = {
  lat: ["lat", "latitude", "y", "projection_y_coordinate", "northing"],
  lon: ["lon", "longitude", "x", "lng", "projection_x_coordinate", "easting"],
};

/**
 * Flat set of all spatial dimension names for quick lookup.
 */
export const SPATIAL_DIM_NAMES = new Set([
  ...SPATIAL_DIMENSION_ALIASES.lat,
  ...SPATIAL_DIMENSION_ALIASES.lon,
]);
