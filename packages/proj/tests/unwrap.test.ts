import { describe, expect, it } from "vitest";
import { nearestCopy, unwrapAlong } from "../src/index.js";

describe("nearestCopy", () => {
  it("moves a value by whole periods next to the reference", () => {
    expect(nearestCopy(-170, 175, 360)).toBe(190);
    expect(nearestCopy(170, -175, 360)).toBe(-190);
  });

  it("leaves a value that's already nearest alone", () => {
    expect(nearestCopy(10, 20, 360)).toBe(10);
  });
});

describe("unwrapAlong", () => {
  it("returns the end value when the path doesn't wrap", () => {
    const valueAt = (t: number) => 100 + 50 * t;
    expect(unwrapAlong(valueAt, { start: 100, period: 512 })).toBe(150);
  });

  it("follows a path across the wrap", () => {
    // From 500 to 540, but the values wrap back to 0 at 512.
    const valueAt = (t: number) => (500 + 40 * t) % 512;
    expect(unwrapAlong(valueAt, { start: 500, period: 512 })).toBeCloseTo(
      540,
      9,
    );
  });

  it("follows a path west across the wrap", () => {
    // From 10 to -30, but the values wrap up to 512 below 0.
    const valueAt = (t: number) => (((10 - 40 * t) % 512) + 512) % 512;
    expect(unwrapAlong(valueAt, { start: 10, period: 512 })).toBeCloseTo(
      -30,
      9,
    );
  });

  it("stays in the copy of a start outside the first period", () => {
    const valueAt = (t: number) => (100 + 50 * t) % 512;
    expect(unwrapAlong(valueAt, { start: 1124, period: 512 })).toBeCloseTo(
      1174,
      9,
    );
  });

  it("ends a whole period away when the path goes once around", () => {
    // Both ends wrap to 0, like the two edges of a 360°-wide image.
    const valueAt = (t: number) => (512 * t) % 512;
    expect(unwrapAlong(valueAt, { start: 0, period: 512 })).toBeCloseTo(512, 9);
  });

  it("unwraps a longitude along a path across the antimeridian", () => {
    // 170°E to 170°W, eastward: 170° to 190°.
    const valueAt = (t: number) => {
      const lng = 170 + 20 * t;
      return lng > 180 ? lng - 360 : lng;
    };
    expect(unwrapAlong(valueAt, { start: 170, period: 360 })).toBeCloseTo(
      190,
      9,
    );
  });
});
