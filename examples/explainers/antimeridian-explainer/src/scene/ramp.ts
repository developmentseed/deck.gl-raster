import type { Rgba } from "../animation/frame.js";

/**
 * #703's viridis-like ramp, as `gdaldem color-relief` entries: value, then
 * red, green and blue. The image's values run 1-42, one per column.
 */
const STOPS: [number, number, number, number][] = [
  [1, 68, 1, 84],
  [11, 59, 82, 139],
  [21, 33, 145, 140],
  [31, 94, 201, 98],
  [42, 253, 231, 37],
];

/** A value's color on the ramp, blended between stops; nodata (0) is clear. */
export function rampColor(value: number): Rgba {
  if (value === 0) {
    return [0, 0, 0, 0];
  }
  const first = STOPS[0]!;
  const last = STOPS[STOPS.length - 1]!;
  const clamped = Math.min(last[0], Math.max(first[0], value));
  for (let i = 1; i < STOPS.length; i++) {
    const below = STOPS[i - 1]!;
    const above = STOPS[i]!;
    if (clamped <= above[0]) {
      const t = (clamped - below[0]) / (above[0] - below[0]);
      const mix = (k: number) =>
        Math.round(below[k]! + t * (above[k]! - below[k]!));
      return [mix(1), mix(2), mix(3), 255];
    }
  }
  return [last[1], last[2], last[3], 255];
}
