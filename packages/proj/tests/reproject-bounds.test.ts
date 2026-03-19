import { describe, expect, it } from "vitest";
import { transformBounds } from "../src/reproject-bounds.js";

describe("transformBounds", () => {
  it("returns the same bounds for an identity projection", () => {
    const identity = (x: number, y: number): [number, number] => [x, y];
    const result = transformBounds(identity, 0, 0, 10, 10);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0);
    expect(result[2]).toBeCloseTo(10);
    expect(result[3]).toBeCloseTo(10);
  });

  it("applies a uniform scale projection", () => {
    const double = (x: number, y: number): [number, number] => [x * 2, y * 2];
    const result = transformBounds(double, 1, 2, 3, 4);
    expect(result).toEqual([2, 4, 6, 8]);
  });

  it("handles a non-linear projection that expands the bbox", () => {
    // Project along a curve: x stays, y becomes y + sin(x * pi / bounds_width)
    // At the midpoint x the curve bows outward, so the reprojected max y should
    // exceed the raw top if we only projected corners.
    const bow = (x: number, y: number): [number, number] => [
      x,
      y + Math.sin(((x - 0) / 10) * Math.PI),
    ];
    const corners_only = transformBounds(bow, 0, 0, 10, 0, { densifyPts: 0 });
    const densified = transformBounds(bow, 0, 0, 10, 0, { densifyPts: 21 });
    // With densification the top edge should capture the bow
    expect(densified[3]).toBeGreaterThan(corners_only[3]);
  });

  it("accepts spread bounds array", () => {
    const identity = (x: number, y: number): [number, number] => [x, y];
    const bounds = [0, 0, 5, 5] as const;
    const result = transformBounds(identity, ...bounds);
    expect(result).toEqual([0, 0, 5, 5]);
  });
});
