import { describe, expect, it } from "vitest";
import { splitFloat64Array } from "../src/fp64.js";

describe("splitFloat64Array", () => {
  it("returns [low, high] Float32Arrays of the same length", () => {
    const [low, high] = splitFloat64Array(new Float64Array([1, 2, 3]));
    expect(low).toBeInstanceOf(Float32Array);
    expect(high).toBeInstanceOf(Float32Array);
    expect(low.length).toBe(3);
    expect(high.length).toBe(3);
  });

  it("high part is Math.fround of each value", () => {
    const values = new Float64Array([13_000_305.123, -4_500_000.7, 0]);
    const [, high] = splitFloat64Array(values);
    for (let i = 0; i < values.length; i++) {
      expect(high[i]).toBe(Math.fround(values[i]!));
    }
  });

  it("high + low reconstructs the original to < 1e-6 m at high magnitude", () => {
    // Values spanning the EPSG:3857-meter range that motivated the fp64 split.
    const values = new Float64Array([
      13_000_305.123, -19_000_000.5, 4_500_000.7, 250.25, 0,
    ]);
    const [low, high] = splitFloat64Array(values);
    for (let i = 0; i < values.length; i++) {
      const reconstructed = high[i]! + low[i]!;
      expect(Math.abs(reconstructed - values[i]!)).toBeLessThan(1e-6);
    }
  });

  it("handles an empty array", () => {
    const [low, high] = splitFloat64Array(new Float64Array([]));
    expect(low.length).toBe(0);
    expect(high.length).toBe(0);
  });
});
