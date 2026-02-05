/** A rectangular subset of a raster in pixel coordinates. */
export type Window = {
  /** Column offset (x position of the left edge). */
  colOff: number;
  /** Row offset (y position of the top edge). */
  rowOff: number;
  /** Width in pixels (number of columns). */
  width: number;
  /** Height in pixels (number of rows). */
  height: number;
};

/**
 * Create a Window, validating that offsets are non-negative and dimensions are
 * positive.
 */
export function createWindow(
  colOff: number,
  rowOff: number,
  width: number,
  height: number,
): Window {
  if (colOff < 0 || rowOff < 0) {
    throw new Error(
      `Window offsets must be non-negative, got colOff=${colOff}, rowOff=${rowOff}`,
    );
  }

  if (width <= 0 || height <= 0) {
    throw new Error(
      `Window dimensions must be positive, got width=${width}, height=${height}`,
    );
  }

  return { colOff, rowOff, width, height };
}

/**
 * Compute the intersection of two windows.
 *
 * Returns null if the windows do not overlap.
 */
export function intersectWindows(a: Window, b: Window): Window | null {
  const colOff = Math.max(a.colOff, b.colOff);
  const rowOff = Math.max(a.rowOff, b.rowOff);
  const colStop = Math.min(a.colOff + a.width, b.colOff + b.width);
  const rowStop = Math.min(a.rowOff + a.height, b.rowOff + b.height);

  const width = colStop - colOff;
  const height = rowStop - rowOff;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { colOff, rowOff, width, height };
}
