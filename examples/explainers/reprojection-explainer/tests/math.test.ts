import { describe, expect, it } from "vitest";
import {
  clamp01,
  easeInOutCubic,
  lerp,
  progress,
} from "../src/animation/math.js";

describe("math", () => {
  it("clamps to [0, 1]", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(2)).toBe(1);
  });

  it("interpolates linearly", () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it("eases in and out symmetrically", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.25)).toBeCloseTo(1 - easeInOutCubic(0.75), 12);
  });

  it("measures progress through an interval", () => {
    expect(progress(50, 100, 200)).toBe(0);
    expect(progress(200, 100, 200)).toBe(0.5);
    expect(progress(400, 100, 200)).toBe(1);
  });

  it("treats a zero-length interval as done once started", () => {
    expect(progress(99, 100, 0)).toBe(0);
    expect(progress(100, 100, 0)).toBe(1);
  });
});
