/**
 * Helpers for longitude bounds near the antimeridian.
 *
 * Bounds here can run past 180°: an east edge past 180° is on the other side
 * of the antimeridian, one world east.
 */

import type { Bounds } from "./transform-bounds.js";
import { nearestCopy } from "./unwrap.js";

/**
 * Move `bounds` so that the west edge is in [-180°, 180°), keeping the width:
 * the east edge may then run past 180°. Bounds 360° or wider become -180° to
 * 180°.
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
 * Split bounds whose east edge may run past 180° into bounds within
 * [-180°, 180°]: two, if they cross the antimeridian.
 */
export function splitAtAntimeridian(bounds: Readonly<Bounds>): Bounds[] {
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
 */
export function unwrapBbox(bbox: Readonly<Bounds>): Bounds {
  const [minX, minY, maxX, maxY] = bbox;
  return [minX, minY, minX > maxX ? maxX + 360 : maxX, maxY];
}
