/**
 * Helpers for an output whose x axis wraps around, like Web Mercator's, which
 * repeats every world width. See {@link RasterReprojector}'s `wrapX` option.
 */

/**
 * How many times {@link unwrapAlong} may halve a step: up to 4,096 steps
 * along one path.
 */
const MAX_UNWRAP_DEPTH = 12;

/**
 * Shift `x` by whole periods to the copy nearest `ref`.
 *
 * @param x A value in any copy.
 * @param ref The value to land next to.
 * @param period The period of the axis, such as one world width.
 */
export function nearestCopy(x: number, ref: number, period: number): number {
  return x - Math.round((x - ref) / period) * period;
}

/**
 * Unwrap a value that wraps around, at the end of a path, given its unwrapped
 * value at the start.
 *
 * `valueAt(t)` gives the value at `t` along the path, from `0` to `1`, in any
 * copy. The path is walked in steps, and each step is moved to the copy
 * nearest the step before. Steps are halved until each moves less than a
 * quarter period, and the midpoint is always checked, so two ends a whole
 * period apart are found: like the two edges of a 360°-wide image, which come
 * back from a projection at the same x.
 *
 * The result is right when the value changes smoothly along the path, as a
 * longitude does along a straight line across an image. A path that winds
 * around a pole, or a value that jumps most of a period between two steps
 * the walk accepts, has no single answer and can give the wrong copy.
 *
 * @param valueAt The value at `t` along the path, in any copy.
 * @param options.start The unwrapped value at `t = 0`.
 * @param options.period The period of the axis, such as one world width.
 * @returns The unwrapped value at `t = 1`.
 * @internal Shared with deck.gl-raster; not part of the public API.
 */
export function unwrapAlong(
  valueAt: (t: number) => number,
  options: { start: number; period: number },
): number {
  const { start, period } = options;

  // The unwrapped value at t1, given the unwrapped value x0 at t0. Always look
  // at the midpoint: two ends a whole period apart look like no step at all.
  const walk = (t0: number, x0: number, t1: number, depth: number): number => {
    const tm = (t0 + t1) / 2;
    let xm = nearestCopy(valueAt(tm), x0, period);
    if (Math.abs(xm - x0) >= period / 4 && depth < MAX_UNWRAP_DEPTH) {
      xm = walk(t0, x0, tm, depth + 1);
    }
    const x1 = nearestCopy(valueAt(t1), xm, period);
    if (Math.abs(x1 - xm) >= period / 4 && depth < MAX_UNWRAP_DEPTH) {
      return walk(tm, xm, t1, depth + 1);
    }
    return x1;
  };

  return walk(0, start, 1, 0);
}
