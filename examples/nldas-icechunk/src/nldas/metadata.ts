/** Public NLDAS-3 icechunk repo (anonymous, CORS-enabled). */
export const REPO_URL =
  "https://nasa-waterinsight.s3.us-west-2.amazonaws.com/virtual-zarr-store/NLDAS-3-icechunk";

/** Branch to read. */
export const BRANCH = "main";

/**
 * Path to the near-surface air temperature array within the store. `Tair` is
 * the array's name in the NLDAS-3 store, so the literal path can't change.
 */
export const SURFACE_TEMP_PATH = "/Tair";

/**
 * Virtual chunk container map: the container name declared in the repo's
 * `config.yaml` → the public HTTPS prefix the browser can fetch. The
 * temperature chunks are virtual references into the original NLDAS-3 source
 * objects in the same `nasa-waterinsight` bucket.
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
 * Sentinel for fill pixels. The store's `missing_value` is -9999, which
 * `FilterNoDataVal` discards on the GPU. The source data uses this finite
 * sentinel (not NaN), so no per-pixel CPU pass is needed.
 */
export const NODATA_VALUE = -9999;

/**
 * Initial rescale range in Kelvin (near-surface air temperature `vmin`/`vmax`
 * ≈ 228–304 K). Adjustable at runtime via the rescale slider.
 */
export const RESCALE_MIN = 228;
export const RESCALE_MAX = 305;

/** Bounds + step for the rescale slider (Kelvin). */
export const RESCALE_SLIDER_MIN = 220;
export const RESCALE_SLIDER_MAX = 320;
export const RESCALE_SLIDER_STEP = 1;

/**
 * Synthetic GeoZarr-compliant attrs (the virtual store is not GeoZarr).
 * Mirrors the ECMWF example's approach.
 *
 * Affine [a,b,c,d,e,f] (see `@developmentseed/affine`):
 *   x = a*col + b*row + c ; y = d*col + e*row + f
 *
 * NLDAS-3 latitude is ASCENDING (row 0 = south, first cell center lat 7.005°),
 * so the row step `e` is positive and the origin is the bottom-left cell
 * corner = first cell center − half a pixel.
 *
 * The grid is an exact 0.01° lon [-169, -52] × lat [7, 72]. Use these exact
 * values rather than ones derived from the store's coordinate arrays: those are
 * float32, so subtracting them yields precision-noised spacing (dLon ≈
 * 0.00999451 → east edge ≈ -52.064, a ~7 km eastward drift by the far edge).
 */
export const NLDAS_GEOZARR_ATTRS = {
  "spatial:dimensions": ["lat", "lon"],
  "spatial:transform": [0.01, 0, -169, 0, 0.01, 7],
  "spatial:shape": [6500, 11700],
  "proj:code": "EPSG:4326",
} as const;
