import { describe, expect, it } from "vitest";
import type { ScheduleOptions } from "../src/animation/refine-schedule.js";
import {
  scheduleRefinement,
  stepAt,
} from "../src/animation/refine-schedule.js";

const OPTIONS: ScheduleOptions = {
  slowSteps: 2,
  highlightMs: 400,
  cutMs: 200,
  snapMs: 300,
  holdMs: 100,
  speedup: 0.5,
  minStepMs: 100,
};
const FULL = 1000;

describe("scheduleRefinement", () => {
  const timings = scheduleRefinement(8, OPTIONS);

  it("plays the first slow steps at full length", () => {
    expect(timings[0]).toEqual({
      start: 0,
      highlightEnd: 400,
      cutEnd: 600,
      snapEnd: 900,
      end: 1000,
    });
    expect(timings[1]!.end - timings[1]!.start).toBe(FULL);
  });

  it("speeds up after the slow steps, down to the minimum", () => {
    const lengths = timings.map((t) => t.end - t.start);
    expect(lengths.slice(2)).toEqual([500, 250, 125, 100, 100, 100]);
  });

  it("runs steps back to back with ordered phases", () => {
    timings.forEach((t, k) => {
      expect(t.start).toBeLessThanOrEqual(t.highlightEnd);
      expect(t.highlightEnd).toBeLessThanOrEqual(t.cutEnd);
      expect(t.cutEnd).toBeLessThanOrEqual(t.snapEnd);
      expect(t.snapEnd).toBeLessThanOrEqual(t.end);
      if (k > 0) {
        expect(t.start).toBe(timings[k - 1]!.end);
      }
    });
  });
});

describe("stepAt", () => {
  const timings = scheduleRefinement(8, OPTIONS);

  it("finds the step containing a time", () => {
    expect(stepAt(timings, -5)).toBe(0);
    expect(stepAt(timings, 0)).toBe(0);
    expect(stepAt(timings, 999)).toBe(0);
    expect(stepAt(timings, 1000)).toBe(1);
    expect(stepAt(timings, timings[5]!.start + 1)).toBe(5);
    expect(stepAt(timings, 1e9)).toBe(7);
  });

  it("returns -1 when there are no steps", () => {
    expect(stepAt([], 10)).toBe(-1);
  });
});
