/** Clamp `t` to [0, 1]. */
export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Linear interpolation from `a` to `b`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Cubic ease-in-out: slow in, slow out. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Fraction of the interval `[start, start + duration]` elapsed at `time`,
 * clamped to [0, 1]. A zero-length interval is complete once it starts.
 */
export function progress(
  time: number,
  start: number,
  duration: number,
): number {
  if (duration <= 0) {
    return time >= start ? 1 : 0;
  }
  return clamp01((time - start) / duration);
}
