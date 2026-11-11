/**
 * URL for the AlphaEarth Foundations GeoZarr Mosaic.
 *
 * See https://source.coop/tge-labs/aef-mosaic.
 */
// We use the S3 URL directly to work around current source.coop bug of not sending Content-Length header
// export const ZARR_URL = "https://data.source.coop/tge-labs/aef-mosaic";
export const ZARR_URL =
  "https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop/tge-labs/aef-mosaic";

/** Path to the embeddings array within the root group. */
export const VARIABLE = "embeddings";

/** Number of embedding dimensions. */
export const NUM_BANDS = 64;

/** Number of annual snapshots (2017 through 2025 inclusive). */
export const NUM_YEARS = 9;

/** Calendar year corresponding to time index 0. */
export const YEAR_ORIGIN = 2017;

/** int8 sentinel written by the producer for missing pixels. */
export const NODATA_INT8 = -128;

/** Dequantization divisor: `(v / 127.5)² · sign(v)`. */
export const DEQUANT_DIVISOR = 127.5;

/**
 * Minimum viewport zoom at which the layer fetches and renders tiles.
 *
 * The AEF source is a single-level zarr at ~10 m/px with no overviews, so
 * lowering this value increases the number of native-resolution tiles fetched
 * per viewport (roughly 4× per step). Every loaded tile keeps 4 MB of
 * embeddings on the CPU and as much again on the GPU, and each model pass
 * runs on all of them, so this is higher than in `aef-mosaic`: a large window
 * shows a few hundred tiles at this zoom.
 */
export const MIN_ZOOM = 12.5;
