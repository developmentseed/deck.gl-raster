import { describe, expect, it } from "vitest";
import { createInitialConditions } from "../src/initial-conditions.js";

describe("createInitialConditions", () => {
  it("triangulates the unit square into two triangles", () => {
    const seed = createInitialConditions([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(seed.uvs).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
    expect(seed.triangles).toHaveLength(6); // two triangles
    expect(seed.halfedges).toHaveLength(6);
    // exactly one interior shared edge (its twin is >= 0); the rest are boundary
    expect(seed.halfedges.filter((h) => h >= 0)).toHaveLength(2);
  });

  it("triangulates a sub-rectangle, keeping all vertices inside it", () => {
    const seed = createInitialConditions([
      [0, 0],
      [0.5, 0],
      [0, 1],
      [0.5, 1],
    ]);
    expect(seed.triangles).toHaveLength(6);
    for (let i = 0; i < seed.uvs.length; i += 2) {
      expect(seed.uvs[i]).toBeLessThanOrEqual(0.5);
    }
  });
});
