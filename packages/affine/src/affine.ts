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

/** The identity transform. */
export function identity(): Affine {
  return [1, 0, 0, 0, 1, 0];
}

/** Create a translation transform. */
export function translation(xoff: number, yoff: number): Affine {
  return [1, 0, xoff, 0, 1, yoff];
}

/** Create a scaling transform. If only one argument, scale uniformly. */
export function scale(sx: number, sy: number = sx): Affine {
  return [sx, 0, 0, 0, sy, 0];
}

/**
 * Apply a geotransform to a coordinate.
 *
 *   x_out = a * x + b * y + c
 *   y_out = d * x + e * y + f
 */
export function apply(
  [a, b, c, d, e, f]: Affine,
  x: number,
  y: number,
): [number, number] {
  return [a * x + b * y + c, d * x + e * y + f];
}

/**
 * Compose two affine transforms: A×B (apply B first, then A).
 *
 * Equivalent to multiplying the 3×3 matrices:
 *   | a1 b1 c1 |   | a2 b2 c2 |
 *   | d1 e1 f1 | × | d2 e2 f2 |
 *   | 0  0  1  |   | 0  0  1  |
 */
export function compose(
  [a1, b1, c1, d1, e1, f1]: Affine,
  [a2, b2, c2, d2, e2, f2]: Affine,
): Affine {
  return [
    a1 * a2 + b1 * d2,
    a1 * b2 + b1 * e2,
    a1 * c2 + b1 * f2 + c1,
    d1 * a2 + e1 * d2,
    d1 * b2 + e1 * e2,
    d1 * c2 + e1 * f2 + f1,
  ];
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
