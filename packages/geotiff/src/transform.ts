import type { Affine } from "@developmentseed/affine";
import { apply, invert } from "@developmentseed/affine";

/**
 * Interface for objects that have an affine transform.
 */
export interface HasTransform {
  /** The affine transform. */
  transform: Affine;
}

/**
 * Get the (row, col) pixel index containing the geographic coordinate (x, y).
 *
 * @param x          x coordinate in the CRS.
 * @param y          y coordinate in the CRS.
 * @param op         Rounding function applied to fractional pixel indices.
 *                   Defaults to Math.floor.
 * @returns          [row, col] pixel indices.
 */
export function index(
  self: HasTransform,
  x: number,
  y: number,
  op: (n: number) => number = Math.floor,
): [number, number] {
  const inv = invert(self.transform);
  const [col, row] = apply(inv, x, y);
  return [op(row), op(col)];
}

/**
 * Get the geographic (x, y) coordinate of the pixel at (row, col).
 *
 * @param row        Pixel row.
 * @param col        Pixel column.
 * @param offset     Which part of the pixel to return.  Defaults to "center".
 * @returns          [x, y] in the CRS.
 */
export function xy(
  self: HasTransform,
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

  return apply(self.transform, c, r);
}
