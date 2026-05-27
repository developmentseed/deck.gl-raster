import { describe, expect, it } from "vitest";
import type { ReprojectionFns } from "../src/delatin.js";
import { RasterReprojector, rectangleSeed } from "../src/delatin.js";

const fns: ReprojectionFns = {
  forwardTransform: (x, y) => [x, y],
  inverseTransform: (x, y) => [x, y],
  forwardReproject: (x, y) => [x + 0.05 * y * y, y],
  inverseReproject: (x, y) => [x - 0.05 * y * y, y],
};

describe("rectangleSeed", () => {
  it("builds the unit square (same as the default seed)", () => {
    const s = rectangleSeed(0, 0, 1, 1);
    expect(s.uvs).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
    expect(s.triangles).toEqual([3, 0, 2, 0, 3, 1]);
    expect(s.halfedges).toEqual([3, -1, -1, 0, -1, -1]);
  });

  it("builds a clamped horizontal band", () => {
    const s = rectangleSeed(0, 0.25, 1, 0.75);
    expect(s.uvs).toEqual([0, 0.25, 1, 0.25, 0, 0.75, 1, 0.75]);
    // topology is identical to the unit square
    expect(s.triangles).toEqual([3, 0, 2, 0, 3, 1]);
    expect(s.halfedges).toEqual([3, -1, -1, 0, -1, -1]);
  });

  it("is a valid reprojector seed (converges, stays in the band)", () => {
    const r = new RasterReprojector(fns, 64, 64, {
      initialTriangulation: rectangleSeed(0, 0.2, 1, 0.8),
    });
    r.run(0.125);
    expect(r.getMaxError()).toBeLessThanOrEqual(0.125); // winding/halfedges valid
    for (let i = 1; i < r.uvs.length; i += 2) {
      expect(r.uvs[i]).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(r.uvs[i]).toBeLessThanOrEqual(0.8 + 1e-9);
    }
  });
});
