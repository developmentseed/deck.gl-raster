/**
 * 2D affine transformations for georeferenced raster data.
 *
 * A TypeScript port of the Python
 * [`affine`](https://github.com/rasterio/affine) library, focused on the
 * subset needed for pixel ↔ CRS conversions: construction (`identity`,
 * `translation`, `scale`, `rotation`), composition (`compose`), inversion
 * (`invert`), and application to coordinates (`apply`).
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
 * which maps `(x, y) → (a*x + b*y + c, d*x + e*y + f)`. The first two
 * rows match the GDAL geotransform convention (with `[c, a, b, f, d, e]`
 * reordered to row-major form).
 *
 * `compose(A, B)` matches Python's `A @ B`: B is applied first, then A. So
 * to express the pixel-to-CRS pipeline "scale, then rotate, then
 * translate", write
 * `compose(translation(...), compose(rotation(...), scale(...)))`.
 */

export type { Affine } from "./affine.js";
export * from "./affine.js";
