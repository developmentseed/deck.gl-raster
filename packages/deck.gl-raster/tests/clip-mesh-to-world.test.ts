import { describe, expect, it } from "vitest";
import type { Mesh2D } from "../src/clip-mesh-to-world.js";
import { clipMeshToWorld } from "../src/clip-mesh-to-world.js";

const P = 512;

function area(positions: number[], triangles: number[]): number {
  let sum = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((j) => 2 * triangles[t + j]!);
    sum +=
      ((positions[b!]! - positions[a!]!) *
        (positions[c! + 1]! - positions[a! + 1]!) -
        (positions[c!]! - positions[a!]!) *
          (positions[b! + 1]! - positions[a! + 1]!)) /
      2;
  }
  return sum;
}

describe("clipMeshToWorld", () => {
  // Unit square in uv, positioned across x = 512 (500..530).
  const mesh: Mesh2D = {
    positions: [500, 0, 530, 0, 500, 10, 530, 10],
    uvs: [0, 0, 1, 0, 0, 1, 1, 1],
    triangles: [3, 0, 2, 0, 3, 1],
  };
  const out = clipMeshToWorld(mesh, P);

  it("preserves signed area and keeps every position in [0, period]", () => {
    expect(area(out.positions, out.triangles)).toBeCloseTo(
      area(mesh.positions, mesh.triangles),
      9,
    );
    for (let i = 0; i < out.positions.length; i += 2) {
      expect(out.positions[i]!).toBeGreaterThanOrEqual(0);
      expect(out.positions[i]!).toBeLessThanOrEqual(P);
    }
  });

  it("interpolates uv linearly at the cut (x = 512 ↔ u = 12/30)", () => {
    for (let i = 0; i < out.positions.length; i += 2) {
      const x = out.positions[i]!;
      const unshifted = x < 100 ? x + P : x;
      expect(out.uvs[i]!).toBeCloseTo((unshifted - 500) / 30, 9);
    }
  });

  it("only shifts a mesh that lies in one copy", () => {
    const shifted: Mesh2D = {
      ...mesh,
      positions: mesh.positions.map((v, i) => (i % 2 === 0 ? v - 530 : v)),
    };
    const result = clipMeshToWorld(shifted, P);
    expect(result.triangles.length).toBe(mesh.triangles.length);
    const xs = result.positions.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(P - 30, 9);
    expect(Math.max(...xs)).toBeCloseTo(P, 9);
  });
});
