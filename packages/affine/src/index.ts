/**
 * 2D affine transformations for georeferenced raster data.
 *
 * A TypeScript port of the Python
 * [`affine`](https://github.com/rasterio/affine) library.
 *
 * An {@link Affine} is a flat 6-element tuple `[a, b, c, d, e, f]` representing
 * the matrix
 *
 * ```
 *   | a b c |
 *   | d e f |
 *   | 0 0 1 |
 * ```
 *
 * which maps `(x, y) → (a*x + b*y + c, d*x + e*y + f)`.
 */

export type { Affine } from "./affine.js";
export * from "./affine.js";
