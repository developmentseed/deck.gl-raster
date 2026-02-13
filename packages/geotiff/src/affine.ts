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

/**
 * Apply a geotransform to a coordinate.
 *
 *   x_out = a * x + b * y + c
 *   y_out = d * x + e * y + f
 */
export function forward(
  [a, b, c, d, e, f]: Affine,
  x: number,
  y: number,
): [number, number] {
  return [a * x + b * y + c, d * x + e * y + f];
}

/**
 * Compute the inverse of an Affine.
 */
export function invert([sa, sb, sc, sd, se, sf]: Affine): Affine {
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
