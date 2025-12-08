export type GeoTransform = [number, number, number, number, number, number];

/**
 * Find the inverse of this GeoTransform.
 *
 * Ported from rasterio/affine:
 * https://github.com/rasterio/affine/blob/a7a916fc7012f8afeb6489246ada61a76ccb8bc7/src/affine.py#L671-L692
 * under the BSD-3-Clause License.
 *
 * @param   {GeoTransform}  gt  Geotransform.
 *
 * @return  {GeoTransform}      Inverse of the geotransform.
 */
export function invertGeoTransform(gt: GeoTransform): GeoTransform {
  if (isDegenerate(gt)) {
    throw new Error("Cannot invert degenerate transform");
  }

  const idet = 1.0 / determinant(gt);
  const [sa, sb, sc, sd, se, sf] = gt;
  const ra = se * idet;
  const rb = -sb * idet;
  const rd = -sd * idet;
  const re = sa * idet;
  // prettier-ignore
  return [
      ra, rb, -sc * ra - sf * rb,
      rd, re, -sc * rd - sf * re,
  ];
}

function isDegenerate(gt: GeoTransform): boolean {
  return determinant(gt) === 0;
}

function determinant(gt: GeoTransform): number {
  return a(gt) * e(gt) - b(gt) * d(gt);
}

function a(gt: GeoTransform): number {
  return gt[0];
}

function b(gt: GeoTransform): number {
  return gt[1];
}

// function c(gt: GeoTransform): number {
//   return gt[2];
// }

function d(gt: GeoTransform): number {
  return gt[3];
}

function e(gt: GeoTransform): number {
  return gt[4];
}

// function f(gt: GeoTransform): number {
//   return gt[5];
// }

/**
 * Apply a GeoTransform to a coordinate.
 */
export function applyAffine(
  x: number,
  y: number,
  gt: [number, number, number, number, number, number],
): [number, number] {
  const [a, b, c, d, e, f] = gt;
  return [a * x + b * y + c, d * x + e * y + f];
}
