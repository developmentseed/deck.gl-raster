/**
 * Standard CRS definitions and tiled bounds.
 *
 * This module provides well-known proj4 definitions for common CRS codes
 * and standard bounds for tiled formats.
 */

/**
 * CRS definition with proj4 string and unit type.
 */
export interface StandardCRSDef {
  /** proj4 definition string */
  def: string;
  /** Unit type for the CRS */
  units: "degree" | "m";
}

/**
 * Standard CRS definitions for common EPSG codes.
 * Keys are uppercase for case-insensitive lookup.
 */
export const STANDARD_CRS: Record<string, StandardCRSDef> = {
  "EPSG:4326": {
    def: "+proj=longlat +datum=WGS84 +no_defs +type=crs",
    units: "degree",
  },
  "EPSG:3857": {
    def: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs",
    units: "m",
  },
};

/**
 * Standard bounds for tiled formats by CRS.
 * These are the full extent bounds for well-known tile matrix sets.
 */
export const TILED_BOUNDS: Record<string, [number, number, number, number]> = {
  "EPSG:4326": [-180, -90, 180, 90],
  "EPSG:3857": [-20037508.34, -20037508.34, 20037508.34, 20037508.34],
};

/**
 * Look up a standard CRS definition by code.
 * Returns undefined if not a standard CRS.
 */
export function getStandardCRS(crsCode: string): StandardCRSDef | undefined {
  return STANDARD_CRS[crsCode.toUpperCase()];
}

/**
 * Look up standard tiled bounds for a CRS code.
 * Returns undefined if not a known tiled CRS.
 */
export function getTiledBounds(
  crsCode: string,
): [number, number, number, number] | undefined {
  return TILED_BOUNDS[crsCode.toUpperCase()];
}
