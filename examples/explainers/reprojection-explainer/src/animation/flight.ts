import { easeInOutCubic, lerp, progress } from "./math.js";

/**
 * How triangles travel from the source panel to the target panel.
 * - `direct`: each triangle moves and reshapes into place in one motion.
 * - `fly-then-snap`: triangles land as an unchanged copy of the source,
 *   then every corner moves to its exact position at once.
 */
export type FlightStyle = "direct" | "fly-then-snap";

/** Timing and shape of a flight. */
export type FlightOptions = {
  /** How triangles travel. */
  style: FlightStyle;
  /** Time each triangle spends in the air, in ms. */
  durationMs: number;
  /** Peak height of each triangle's arc, in slide units (upward). */
  arcHeight: number;
  /** Fly-then-snap: pause between the last landing and the snap, in ms. */
  snapDelayMs: number;
  /** Fly-then-snap: duration of the snap, in ms. */
  snapDurationMs: number;
};

/** Per-corner positions (2 per corner, 3 corners per triangle). */
export type FlightPaths = {
  /** Start: on the source panel. */
  source: Float32Array;
  /** Fly-then-snap landing: an unchanged copy of the source layout. */
  copy: Float32Array;
  /** End: exact reprojected positions on the target panel. */
  target: Float32Array;
};

/**
 * Launch delays in ms that send the eastmost triangle first and the
 * westmost `spreadMs` later, so no triangle overtakes another.
 */
export function eastFirstDelays(
  centroidX: ArrayLike<number>,
  spreadMs: number,
): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < centroidX.length; i++) {
    min = Math.min(min, centroidX[i]!);
    max = Math.max(max, centroidX[i]!);
  }
  const range = max - min;
  return Float32Array.from(centroidX, (x) =>
    range > 0 ? ((max - x) / range) * spreadMs : 0,
  );
}

/** Total duration of a flight with these launch delays, in ms. */
export function flightDuration(
  delays: ArrayLike<number>,
  options: FlightOptions,
): number {
  const landed = lastDelay(delays) + options.durationMs;
  return options.style === "direct"
    ? landed
    : landed + options.snapDelayMs + options.snapDurationMs;
}

/** Per-corner positions of every triangle `timeMs` after the flight starts. */
export function flightPositions(
  paths: FlightPaths,
  delays: ArrayLike<number>,
  timeMs: number,
  options: FlightOptions,
): Float32Array {
  const { source, copy, target } = paths;
  const landing = options.style === "direct" ? target : copy;
  const snapStart =
    lastDelay(delays) + options.durationMs + options.snapDelayMs;
  const snap =
    options.style === "direct"
      ? 0
      : easeInOutCubic(progress(timeMs, snapStart, options.snapDurationMs));
  const out = new Float32Array(source.length);
  const triangleCount = source.length / 6;
  for (let t = 0; t < triangleCount; t++) {
    const raw = progress(timeMs, delays[t]!, options.durationMs);
    const along = easeInOutCubic(raw);
    const lift = options.arcHeight * Math.sin(Math.PI * raw);
    for (let k = 0; k < 6; k += 2) {
      const i = 6 * t + k;
      const x = lerp(source[i]!, landing[i]!, along);
      const y = lerp(source[i + 1]!, landing[i + 1]!, along) - lift;
      out[i] = lerp(x, target[i]!, snap);
      out[i + 1] = lerp(y, target[i + 1]!, snap);
    }
  }
  return out;
}

/** Largest launch delay. */
function lastDelay(delays: ArrayLike<number>): number {
  let last = 0;
  for (let i = 0; i < delays.length; i++) {
    last = Math.max(last, delays[i]!);
  }
  return last;
}
