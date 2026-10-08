/** When the phases of one refinement step end, in ms from the sequence start. */
export type StepTiming = {
  /** Step start. */
  start: number;
  /** End of the highlight (worst triangle and its red dot shown). */
  highlightEnd: number;
  /** End of the cut (new edges appear). */
  cutEnd: number;
  /** End of the snap (new corner moves to its exact position). */
  snapEnd: number;
  /** End of the step, after a short hold. */
  end: number;
};

/** Pacing of the refinement replay. */
export type ScheduleOptions = {
  /** Number of steps played at full length. */
  slowSteps: number;
  /** Highlight phase of a full-length step, in ms. */
  highlightMs: number;
  /** Cut phase of a full-length step, in ms. */
  cutMs: number;
  /** Snap phase of a full-length step, in ms. */
  snapMs: number;
  /** Hold after a full-length step, in ms. */
  holdMs: number;
  /** Each step after the slow ones is this fraction of the previous one. */
  speedup: number;
  /** Shortest a step may get, in ms. */
  minStepMs: number;
};

/** Default pacing: 3 slow steps, then speeding up to 40 ms per step. */
export const DEFAULT_SCHEDULE: ScheduleOptions = {
  slowSteps: 3,
  highlightMs: 600,
  cutMs: 250,
  snapMs: 600,
  holdMs: 250,
  speedup: 0.75,
  minStepMs: 40,
};

/** Phase timings of `stepCount` refinement steps played back to back. */
export function scheduleRefinement(
  stepCount: number,
  options: ScheduleOptions,
): StepTiming[] {
  const full =
    options.highlightMs + options.cutMs + options.snapMs + options.holdMs;
  const timings: StepTiming[] = [];
  let time = 0;
  for (let k = 0; k < stepCount; k++) {
    const factor =
      k < options.slowSteps
        ? 1
        : Math.max(
            options.speedup ** (k - options.slowSteps + 1),
            options.minStepMs / full,
          );
    const start = time;
    const highlightEnd = start + options.highlightMs * factor;
    const cutEnd = highlightEnd + options.cutMs * factor;
    const snapEnd = cutEnd + options.snapMs * factor;
    const end = snapEnd + options.holdMs * factor;
    timings.push({ start, highlightEnd, cutEnd, snapEnd, end });
    time = end;
  }
  return timings;
}

/**
 * Index of the step playing at `timeMs`: 0 before the first step, the last
 * step after the end, and -1 when there are no steps.
 */
export function stepAt(timings: StepTiming[], timeMs: number): number {
  if (timings.length === 0) {
    return -1;
  }
  let lo = 0;
  let hi = timings.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timings[mid]!.start <= timeMs) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}
