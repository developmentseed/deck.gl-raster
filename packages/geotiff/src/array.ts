import type { Affine } from "./affine.js";

/**
 * Decoded raster data from a GeoTIFF region.
 *
 * Data is stored in pixel-interleaved order: for each pixel in row-major
 * order, all band values are contiguous.  The flat array length is
 * `height * width * bands`.
 */
export type RasterArray = {
  /** Pixel-interleaved raster data. Length = height * width * bands. */
  data: ArrayBuffer;

  /**
   * Optional validity mask.  Length = height * width.
   * 1 = valid pixel, 0 = nodata.  null when no mask IFD is present.
   */
  mask: Uint8Array | null;

  /** Number of bands (samples per pixel). */
  count: number;

  /** Height in pixels. */
  height: number;

  /** Width in pixels. */
  width: number;

  /**
   * Affine geotransform [a, b, c, d, e, f] mapping pixel (col, row) to
   * geographic (x, y):
   *   x = a * col + b * row + c
   *   y = d * col + e * row + f
   */
  transform: Affine;

  crs: string;

  nodata: number | null;
};
