/**
 * Affine geotransform: [a, b, c, d, e, f].
 *
 * Maps pixel (col, row) to geographic (x, y):
 *   x = a * col + b * row + c
 *   y = d * col + e * row + f
 */
export type Affine = [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];
