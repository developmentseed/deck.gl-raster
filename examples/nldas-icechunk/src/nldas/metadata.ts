import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";

/** Public NLDAS-3 icechunk repo (anonymous, CORS-enabled). */
export const REPO_URL =
  "https://nasa-waterinsight.s3.us-west-2.amazonaws.com/virtual-zarr-store/NLDAS-3-icechunk";

/** Branch to read. */
export const BRANCH = "main";

/** Path to the Tair array within the store. */
export const VARIABLE = "/Tair";

/**
 * Virtual chunk container map: the container name declared in the repo's
 * `config.yaml` → the public HTTPS prefix the browser can fetch. Tair's chunks
 * are virtual references into the original NLDAS-3 source objects in the same
 * `nasa-waterinsight` bucket.
 */
export const VIRTUAL_CHUNK_CONTAINERS = new Map([
  [
    "s3://nasa-waterinsight/NLDAS3/forcing/daily/",
    "https://nasa-waterinsight.s3.us-west-2.amazonaws.com/NLDAS3/forcing/daily/",
  ],
]);

/** Name of the non-spatial dimension (array dims are ["time", "lat", "lon"]). */
export const TIME_DIM = "time";

/**
 * Which timestep to render (single static frame). Time is "days since
 * 2001-01-01" with one-day increments, so index 3482 = 2010-07-16 — a summer
 * day with good thermal contrast over North America.
 */
export const TIME_INDEX = 3482;

/**
 * Sentinel for fill pixels. The store's `missing_value` is -9999; getTileData
 * also maps any non-finite (NaN/Inf) value to this so the render pipeline can
 * discard them with a single comparison.
 */
export const NODATA_VALUE = -9999;

/** Fixed rescale range in Kelvin (Tair `vmin`/`vmax` ≈ 228–304 K). */
export const RESCALE_MIN = 228;
export const RESCALE_MAX = 305;

/** Colormap sprite layer + orientation (thermal sequential, like ECMWF). */
export const COLORMAP_INDEX_TAIR = COLORMAP_INDEX.thermal;
export const COLORMAP_REVERSED = false;

/**
 * Synthetic GeoZarr-compliant attrs (the virtual store is not GeoZarr).
 * Mirrors the ECMWF example's approach. Values derived from the store by
 * `scripts/smoke.ts`.
 *
 * Affine [a,b,c,d,e,f] (see `@developmentseed/affine`):
 *   x = a*col + b*row + c ; y = d*col + e*row + f
 *
 * NLDAS-3 latitude is ASCENDING (row 0 = south, lat 7.005°), so the row step
 * `e` is positive and the origin is the bottom-left cell corner = first cell
 * center − half a pixel. Grid: 0.01° over lon [-169, -52], lat [7, 72].
 */
export const NLDAS_GEOZARR_ATTRS = {
  "spatial:dimensions": ["lat", "lon"],
  "spatial:transform": [
    0.0099945068359375, 0, -168.99999237060547, 0, 0.010000228881835938, 7,
  ],
  "spatial:shape": [6500, 11700],
  "proj:code": "EPSG:4326",
} as const;
