import type { Bounds } from "./types.js";

/**
 * Intersect two axis-aligned boxes, each `[minX, minY, maxX, maxY]` in the same
 * coordinate system.
 *
 * @returns The box both cover. When they don't overlap, its min is greater than
 *          its max on at least one axis; the caller decides whether boxes that
 *          only touch count as overlapping.
 */
export function intersectBounds(a: Bounds, b: Bounds): Bounds {
  return [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
}
