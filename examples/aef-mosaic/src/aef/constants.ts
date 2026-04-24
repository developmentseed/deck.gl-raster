/**
 * Direct S3 URL for the AlphaEarth Foundations GeoZarr Mosaic.
 * See https://source.coop/tge-labs/aef-mosaic.
 */
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
 * Minimum viewport zoom at which the layer fetches tiles. Below this,
 * tile requests stop — but already-cached tiles may keep rendering down
 * to {@link VISIBLE_MIN_ZOOM}, controlled independently by the layer.
 */
export const FETCH_MIN_ZOOM = 12;

/**
 * Minimum viewport zoom at which the layer renders anything. Tiles that
 * have already been fetched at zoom ≥ {@link FETCH_MIN_ZOOM} keep showing
 * down to this level, so zooming out by one level stays smooth instead of
 * snapping to blank. Below this the layer is invisible.
 */
export const VISIBLE_MIN_ZOOM = 11;
