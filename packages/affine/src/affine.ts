/**
 * Affine geotransform: `[a, b, c, d, e, f]`.
 *
 * Maps pixel (col, row) to geographic (x, y):
 *
 * ```
 * x = a * col + b * row + c
 * y = d * col + e * row + f
 * ```
 */
export type Affine = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

// Create a single identity array to reuse for all calls to `identity()`.
const ident: Affine = [1, 0, 0, 0, 1, 0];

/**
 * Access the identity affine transform, which maps pixel coordinates to
 * themselves.
 *
 * @return  The identity affine transform.
 */
export function identity(): Affine {
  return ident;
}

/**
 * Create a translation transform from an offset vector.
 *
 * @param xoff  Translation offset in x direction.
 * @param yoff  Translation offset in y direction.
 *
 * @return Transform that applies the given translation.
 */
export function translation(xoff: number, yoff: number): Affine {
  return [1, 0, xoff, 0, 1, yoff];
}

/**
 * Create a scaling transform from a scalar or vector.
 *
 * You can pass either one or two scaling factors. Passing only a single scalar
 * value will scale in both dimensions equally. A vector scaling value scales
 * the dimensions independently.
 *
 * @param sx  Scaling factor in x direction.
 * @param sy  Scaling factor in y direction (defaults to sx if not provided).
 *
 * @return Transform that applies the given scaling.
 */
export function scale(sx: number, sy: number = sx): Affine {
  return [sx, 0, 0, 0, sy, 0];
}

/**
 * Create a rotation transform.
 *
 * Rotates counter-clockwise by `angle` degrees about the given pivot point
 * (defaults to the origin `(0, 0)`). Ported from the Python
 * [`affine`](https://github.com/rasterio/affine) library.
 *
 * @param angle  Rotation angle in degrees, counter-clockwise about the pivot.
 * @param pivot  Optional pivot point `[px, py]`. Defaults to `[0, 0]`.
 *
 * @return Transform that applies the given rotation.
 */
export function rotation(
  angle: number,
  pivot: readonly [number, number] = [0, 0],
): Affine {
  const [ca, sa] = cosSinDeg(angle);
  const [px, py] = pivot;
  if (px === 0 && py === 0) {
    return [ca, -sa, 0, sa, ca, 0];
  }
  // biome-ignore format: array
  return [
    ca, -sa, px - px * ca + py * sa,
    sa, ca, py - px * sa - py * ca,
  ];
}

/**
 * Return the cosine and sine of an angle in degrees, special-casing exact
 * multiples of 90° so right angles produce exact 0 / ±1 instead of the
 * floating-point error that `Math.cos(Math.PI/2)` etc. would emit.
 *
 * Ported from the Python `affine` library's `cos_sin_deg`.
 */
function cosSinDeg(deg: number): [number, number] {
  // JS `%` preserves the dividend's sign (`-90 % 360 === -90`), unlike
  // Python's modulo which normalizes to [0, 360). The `+ 360) % 360`
  // dance gives us Python-style wrapping so the right-angle short-circuits
  // below also fire for negative angles like `-90`.
  const wrapped = ((deg % 360) + 360) % 360;
  if (wrapped === 0) {
    return [1, 0];
  }
  if (wrapped === 90) {
    return [0, 1];
  }
  if (wrapped === 180) {
    return [-1, 0];
  }
  if (wrapped === 270) {
    return [0, -1];
  }
  const rad = (wrapped * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

/**
 * Apply a geotransform to a coordinate.
 *
 * That is, we apply this series of equations:
 *
 * ```
 *  x_out = a * x + b * y + c
 *  y_out = d * x + e * y + f
 * ```
 *
 * @param affine  The affine transform to apply.
 * @param x       The x coordinate.
 * @param y       The y coordinate.
 *
 * @return The transformed coordinates.
 */
export function apply(
  [a, b, c, d, e, f]: Affine,
  x: number,
  y: number,
): [x: number, y: number] {
  // biome-ignore format: array
  return [
    a * x + b * y + c,
    d * x + e * y + f
  ];
}

/**
 * Compose two affine transforms: A×B (apply B **first**, then A).
 *
 * This is equivalent to `a @ b` in Python's `affine` library, and is equivalent
 * to multiplying the 3×3 matrices:
 * ```
 *   | a1 b1 c1 |   | a2 b2 c2 |
 *   | d1 e1 f1 | × | d2 e2 f2 |
 *   | 0  0  1  |   | 0  0  1  |
 * ```
 *
 * @param A The first affine transform to apply.
 * @param B The second affine transform to apply.
 *
 * @return The composed affine transform.
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
 *
 * @param affine  The affine transform to invert.
 * @return The inverted affine transform.
 * @throws If the transform is degenerate and cannot be inverted.
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

  // biome-ignore format: array
  return [
    ra, rb, -sc * ra - sf * rb,
    rd, re, -sc * rd - sf * re
  ];
}

/** Get the 'a' component of an Affine transform. */
export function a(affine: Affine): number {
  return affine[0];
}

/** Get the 'b' component of an Affine transform. */
export function b(affine: Affine): number {
  return affine[1];
}

/** Get the 'c' component of an Affine transform. */
export function c(affine: Affine): number {
  return affine[2];
}

/** Get the 'd' component of an Affine transform. */
export function d(affine: Affine): number {
  return affine[3];
}

/** Get the 'e' component of an Affine transform. */
export function e(affine: Affine): number {
  return affine[4];
}

/** Get the 'f' component of an Affine transform. */
export function f(affine: Affine): number {
  return affine[5];
}
