import type { GeoTransform } from "@developmentseed/raster-reproject/affine";
import {
  applyAffine,
  invertGeoTransform,
} from "@developmentseed/raster-reproject/affine";

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
  transform: GeoTransform,
  x: number,
  y: number,
  op: (n: number) => number = Math.floor,
): [number, number] {
  const inv = invertGeoTransform(transform);
  // applyAffine(col, row, gt) → [x, y], so with the inverse:
  // applyAffine(x, y, inv) → [col, row]
  const [col, row] = applyAffine(x, y, inv);
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
  transform: GeoTransform,
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

  return applyAffine(c, r, transform);
}
