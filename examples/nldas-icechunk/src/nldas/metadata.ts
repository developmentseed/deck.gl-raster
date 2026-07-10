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
 * Virtual chunk containers authorizing the browser to resolve the store's
 * virtual chunk references. The temperature chunks are virtual references into
 * the original NLDAS-3 source objects (`s3://nasa-waterinsight/...`) in the
 * same `nasa-waterinsight` bucket; `urlPrefix` matches those absolute chunk
 * locations, and the `s3` config directs icechunk to the bucket's regional
 * endpoint — `https://nasa-waterinsight.s3.us-west-2.amazonaws.com/...` — which
 * is required for browser CORS (the global endpoint's region redirect carries
 * no CORS headers).
 */
export const VIRTUAL_CHUNK_CONTAINERS = [
  {
    name: null,
    urlPrefix: "s3://nasa-waterinsight/NLDAS3/forcing/daily/",
    s3: { region: "us-west-2" },
  },
];

/** Name of the non-spatial dimension (array dims are ["time", "lat", "lon"]). */
export const TIME_DIM = "time";

/**
 * Which timestep to render (single static frame). Time is "days since
 * 2001-01-01" with one-day increments, so index 3482 = 2010-07-16 — a summer
 * day with good thermal contrast over North America.
 */
export const TIME_INDEX = 3482;

/**
 * Initial rescale range in Kelvin (near-surface air temperature `vmin`/`vmax`
 * ≈ 228–304 K). Adjustable at runtime via the rescale slider.
 */
export const RESCALE_MIN = 260;
export const RESCALE_MAX = 305;

/** Bounds + step for the rescale slider (Kelvin). */
export const RESCALE_SLIDER_MIN = 240;
export const RESCALE_SLIDER_MAX = 320;
export const RESCALE_SLIDER_STEP = 1;

/**
 * Synthetic GeoZarr-compliant attrs (the virtual store is not GeoZarr).
 */
export const NLDAS_GEOZARR_ATTRS = {
  "spatial:dimensions": ["lat", "lon"],
  "spatial:transform": [0.01, 0, -169, 0, 0.01, 7],
  "spatial:shape": [6500, 11700],
  "proj:code": "EPSG:4326",
} as const;
