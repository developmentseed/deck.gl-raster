/**
 * A rectangular region of an image, in pixels.
 *
 * Mirrors async-geotiff's `Window`: like rasterio's, but with integer offsets
 * and sizes only.
 */
export type Window = {
  /** The column offset: the x position of the window's left edge. */
  colOff: number;
  /** The row offset: the y position of the window's top edge. */
  rowOff: number;
  /** The width in pixels (number of columns). */
  width: number;
  /** The height in pixels (number of rows). */
  height: number;
};

/**
 * Thrown by `GeoTIFF.read` and `Overview.read` when a {@link Window} is invalid
 * or extends outside the image.
 */
export class WindowError extends Error {
  override name = "WindowError";
}
