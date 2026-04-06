import type { Affine } from "@developmentseed/affine";

/**
 * A single resolution level in a GeoZarr dataset.
 *
 * Affine maps pixel (col, row) → source CRS (x, y):
 *   x = a*col + b*row + c
 *   y = d*col + e*row + f
 */
export interface MultiscaleLevel {
  /** Path within the Zarr group, e.g. "0", "1", "2". */
  path: string;
  /** Affine transform from pixel (col, row) to source CRS (x, y). */
  affine: Affine;
  /** Array width in pixels. */
  arrayWidth: number;
  /** Array height in pixels. */
  arrayHeight: number;
}

/** CRS information extracted from the geo-proj convention. */
export interface CRSInfo {
  /**
   * Authority:code string, e.g. "EPSG:4326" or "ESRI:102003".
   * Present when "proj:code" is used.
   */
  code?: string;
  /** WKT2 string. Present when "proj:wkt2" is used. */
  wkt2?: string;
  /** PROJJSON object. Present when "proj:projjson" is used. */
  projjson?: Record<string, unknown>;
}

/**
 * Parsed GeoZarr metadata, ready for use by ZarrLayer.
 *
 * Levels are ordered finest-first (natural Zarr order).
 * Length 1 for single-resolution datasets.
 */
export interface GeoZarrMetadata {
  /** Levels ordered finest-first. Reverse to get coarsest-first for TilesetDescriptor. */
  levels: MultiscaleLevel[];
  /** CRS extracted from the geo-proj convention. */
  crs: CRSInfo;
  /** Axis names from the spatial convention, e.g. ["y", "x"] or ["time", "y", "x"]. */
  axes: string[];
  /** Index of the y axis in `axes`. */
  yAxisIndex: number;
  /** Index of the x axis in `axes`. */
  xAxisIndex: number;
}
