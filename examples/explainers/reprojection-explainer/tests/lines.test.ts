import { describe, expect, it } from "vitest";
import {
  imageOutlineInPixels,
  imageOutlineInWebMercator,
  parallelInPixels,
  parallelInWebMercator,
  polylineBounds,
} from "../src/scene/lines.js";
import { NLCD_HEIGHT, NLCD_WIDTH } from "../src/scene/nlcd.js";

describe("parallels", () => {
  it("draws 49°N as a smile in source pixels", () => {
    const line = parallelInPixels(49, [-129.25, -63.17], 3);
    expect(line[0]![1]).toBeCloseTo(0, 0);
    expect(line[1]![1]).toBeCloseTo(222.2, 0);
    expect(line[2]![1]).toBeCloseTo(5.5, 0);
  });

  it("draws 49°N as a straight line in Web Mercator", () => {
    const ys = parallelInWebMercator(49, [-129, -63], 17).map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-6);
  });
});

describe("image outline", () => {
  it("is a closed, densified ring in pixels", () => {
    const ring = imageOutlineInPixels(NLCD_WIDTH, NLCD_HEIGHT, 4);
    expect(ring.length).toBe(4 * 4 + 1);
    expect(ring[0]).toEqual([0, 0]);
    expect(ring[ring.length - 1]).toEqual([0, 0]);
    expect(ring[4]).toEqual([NLCD_WIDTH, 0]);
  });

  it("reprojects to the known Web Mercator footprint", () => {
    const bounds = polylineBounds(
      imageOutlineInWebMercator(NLCD_WIDTH, NLCD_HEIGHT, 64),
    );
    const expected = [-14391085, 2488141, -7026311, 6968531];
    bounds.forEach((value, i) => {
      expect(Math.abs(value - expected[i]!)).toBeLessThan(100);
    });
  });
});
