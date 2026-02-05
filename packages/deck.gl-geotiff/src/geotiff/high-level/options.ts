import type { Pool } from "geotiff";

/**
 * Options for fetching raster data from a GeoTIFF.
 */
export type FetchOptions = {
  /** GeoTIFF.js decoder pool.  If not provided, a default shared pool is used. */
  pool?: Pool;
  /** AbortSignal to cancel the fetch operation. */
  signal?: AbortSignal;
};
