/**
 * Helpers for longitude bounds near the antimeridian.
 *
 * The bounds these helpers take and return, `[minX, minY, maxX, maxY]` in
 * degrees, can have an east edge past 180°. That part is on the other side of
 * the antimeridian, one world east: `[170, -10, 190, 10]` covers 170°E to
 * 170°W.
 */

import type { Bounds } from "./transform-bounds.js";
import { nearestCopy } from "./unwrap.js";

/**
 * Move `bounds` so that the west edge is in [-180°, 180°), keeping the width:
 * the east edge may then run past 180°. Bounds 360° or wider become -180° to
 * 180°.
 *
 * @example
 * Bounds one world east, as a map can give them for a view across the
 * antimeridian, move back by 360°:
 *
 * ```ts
 * normalizeLongitudes([535, -10, 545, 10]); // [175, -10, 185, 10]
 * normalizeLongitudes([-400, -10, 400, 10]); // [-180, -10, 180, 10]
 * ```
 */
export function normalizeLongitudes(bounds: Readonly<Bounds>): Bounds {
  const [minX, minY, maxX, maxY] = bounds;
  if (maxX - minX >= 360) {
    return [-180, minY, 180, maxY];
  }
  const shift = minX - nearestCopy(minX, 0, 360);
  return [minX - shift, minY, maxX - shift, maxY];
}

/**
 * Split bounds whose east edge runs past 180° in two at the antimeridian, one
 * part on each side. Bounds that end at or before 180° come back whole.
 *
 * Both parts lie within [-180°, 180°] when `bounds` starts in [-180°, 180°)
 * and is at most 360° wide, as {@link normalizeLongitudes} and
 * {@link unwrapBbox} return them.
 *
 * @example
 * ```ts
 * splitAtAntimeridian([170, -10, 190, 10]);
 * // [[170, -10, 180, 10], [-180, -10, -170, 10]]
 * splitAtAntimeridian([10, -10, 20, 10]); // [[10, -10, 20, 10]]
 * ```
 */
export function splitAtAntimeridian(
  bounds: Readonly<Bounds>,
): [Bounds] | [Bounds, Bounds] {
  const [minX, minY, maxX, maxY] = bounds;
  if (maxX <= 180) {
    return [[minX, minY, maxX, maxY]];
  }
  return [
    [minX, minY, 180, maxY],
    [-180, minY, maxX - 360, maxY],
  ];
}

/**
 * Move the east edge of a bbox across the antimeridian, written with
 * `minX > maxX` as GeoJSON and STAC write it, one world east: then
 * `minX < maxX`, and `maxX` runs past 180°. Any other bbox keeps its edges.
 *
 * @example
 * Fiji, the example in RFC 7946 section 5.2:
 *
 * ```ts
 * unwrapBbox([177, -20, -178, -16]); // [177, -20, 182, -16]
 * unwrapBbox([10, -10, 20, 10]); // [10, -10, 20, 10]
 * ```
 */
export function unwrapBbox(bbox: Readonly<Bounds>): Bounds {
  const [minX, minY, maxX, maxY] = bbox;
  return [minX, minY, minX > maxX ? maxX + 360 : maxX, maxY];
}
