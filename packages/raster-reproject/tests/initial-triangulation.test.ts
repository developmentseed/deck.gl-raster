import Delaunator from "delaunator";
import { describe, expect, it } from "vitest";
import type { InitialTriangulation, ReprojectionFns } from "../src/delatin.js";
import { RasterReprojector } from "../src/delatin.js";

// The delaunator seed pattern documented on InitialTriangulation. Building the
// seed here (rather than shipping a wrapper) doubles as both the worked example
// and the winding-compatibility check: if delaunator's orientation were
// incompatible with delatin's `orient`/`inCircle`, a seeded reprojector would
// fail to converge below.
function seedFromPoints(points: [number, number][]): InitialTriangulation {
  const d = Delaunator.from(points);
  return {
    uvs: Array.from(d.coords),
    triangles: Array.from(d.triangles),
    halfedges: Array.from(d.halfedges),
  };
}

// Identity transforms; a reproject with a strong nonlinearity in v so the mesh
// must subdivide (linear interpolation of a quadratic has real error).
const fns: ReprojectionFns = {
  forwardTransform: (x, y) => [x, y],
  inverseTransform: (x, y) => [x, y],
  forwardReproject: (x, y) => [x + 0.05 * y * y, y],
  inverseReproject: (x, y) => [x - 0.05 * y * y, y],
};

describe("RasterReprojector initial triangulation", () => {
  it("defaults to the full unit square (unchanged behavior)", () => {
    const r = new RasterReprojector(fns, 64, 64);
    // Before refinement, the seed is the 4 unit-square corners + 2 triangles.
    expect(r.uvs.slice(0, 8)).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
    expect(r.triangles.slice(0, 6)).toEqual([3, 0, 2, 0, 3, 1]);
  });

  it("converges when seeded from a delaunator unit square (winding compatible)", () => {
    const seed = seedFromPoints([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    const r = new RasterReprojector(fns, 64, 64, {
      initialTriangulation: seed,
    });
    r.run(0.125);
    expect(r.uvs.length).toBeGreaterThan(8); // refinement happened
    expect(r.triangles.length % 3).toBe(0); // valid triangle list
    expect(r.getMaxError()).toBeLessThanOrEqual(0.125); // converged
  });

  it("confines refinement to the seed sub-domain", () => {
    const seed = seedFromPoints([
      [0, 0],
      [0.5, 0],
      [0, 1],
      [0.5, 1],
    ]);
    const r = new RasterReprojector(fns, 64, 64, {
      initialTriangulation: seed,
    });
    r.run(0.125);
    // refinement only splits existing triangles, so no vertex escapes u <= 0.5
    for (let i = 0; i < r.uvs.length; i += 2) {
      expect(r.uvs[i]).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});
