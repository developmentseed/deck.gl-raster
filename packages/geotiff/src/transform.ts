import type { Affine } from "./affine.js";

/**
 * Get the (row, col) pixel index containing the geographic coordinate (x, y).
 *
 * @param transform  Affine geotransform [a, b, c, d, e, f].
 * @param x          x coordinate in the CRS.
 * @param y          y coordinate in the CRS.
 * @param op         Rounding function applied to fractional pixel indices.
 *                   Defaults to Math.floor.
 * @returns          [row, col] pixel indices.
 */
export function index(
  transform: Affine,
  x: number,
  y: number,
  op: (n: number) => number = Math.floor,
): [number, number] {
  const inv = invertGeoTransform(transform);
  const [col, row] = applyGeoTransform(x, y, inv);
  return [op(row), op(col)];
}

/**
 * Get the geographic (x, y) coordinate of the pixel at (row, col).
 *
 * @param transform  Affine geotransform [a, b, c, d, e, f].
 * @param row        Pixel row.
 * @param col        Pixel column.
 * @param offset     Which part of the pixel to return.  Defaults to "center".
 * @returns          [x, y] in the CRS.
 */
export function xy(
  transform: Affine,
  row: number,
  col: number,
  offset: "center" | "ul" | "ur" | "ll" | "lr" = "center",
): [number, number] {
  let c: number;
  let r: number;

  switch (offset) {
    case "center":
      c = col + 0.5;
      r = row + 0.5;
      break;
    case "ul":
      c = col;
      r = row;
      break;
    case "ur":
      c = col + 1;
      r = row;
      break;
    case "ll":
      c = col;
      r = row + 1;
      break;
    case "lr":
      c = col + 1;
      r = row + 1;
      break;
  }

  return applyGeoTransform(c, r, transform);
}

/**
 * Apply a geotransform to a coordinate.
 *
 *   x_out = a * x + b * y + c
 *   y_out = d * x + e * y + f
 */
export function applyGeoTransform(
  x: number,
  y: number,
  gt: Affine,
): [number, number] {
  const [a, b, c, d, e, f] = gt;
  return [a * x + b * y + c, d * x + e * y + f];
}

/**
 * Compute the inverse of a geotransform.
 */
export function invertGeoTransform(gt: Affine): Affine {
  const [sa, sb, sc, sd, se, sf] = gt;
  const det = sa * se - sb * sd;

  if (det === 0) {
    throw new Error("Cannot invert degenerate transform");
  }

  const idet = 1.0 / det;
  const ra = se * idet;
  const rb = -sb * idet;
  const rd = -sd * idet;
  const re = sa * idet;

  return [ra, rb, -sc * ra - sf * rb, rd, re, -sc * rd - sf * re];
}
