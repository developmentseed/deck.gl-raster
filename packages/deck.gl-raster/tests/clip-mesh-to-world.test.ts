import { describe, expect, it } from "vitest";
import type { Mesh2D } from "../src/clip-mesh-to-world.js";
import { clipMeshToWorld } from "../src/clip-mesh-to-world.js";

/** One world width in deck.gl's common space. */
const WORLD = 512;

/** Total signed area of a mesh's triangles. */
function area({ positions: p, triangles }: Mesh2D): number {
  let sum = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((j) => 2 * triangles[t + j]!) as [
      number,
      number,
      number,
    ];
    sum +=
      ((p[b]! - p[a]!) * (p[c + 1]! - p[a + 1]!) -
        (p[c]! - p[a]!) * (p[b + 1]! - p[a + 1]!)) /
      2;
  }
  return sum;
}

const xsOf = ({ positions }: Mesh2D) => positions.filter((_, i) => i % 2 === 0);

/** A 30-unit-wide rectangle (two triangles) from `west`, with UVs 0–1. */
function rectangle(west: number): Mesh2D {
  return {
    positions: [west, 0, west + 30, 0, west, 10, west + 30, 10],
    uvs: [0, 0, 1, 0, 0, 1, 1, 1],
    triangles: [3, 0, 2, 0, 3, 1],
  };
}

describe("clipMeshToWorld", () => {
  it("leaves a mesh inside one world unchanged", () => {
    const mesh = rectangle(100);
    expect(clipMeshToWorld(mesh, WORLD)).toEqual(mesh);
  });

  it("moves a mesh that lies one world over back into the world", () => {
    const mesh = rectangle(WORLD + 100);
    const clipped = clipMeshToWorld(mesh, WORLD);
    expect(clipped.triangles).toEqual(mesh.triangles);
    expect(clipped.uvs).toEqual(mesh.uvs);
    expect(clipped.positions).toEqual(rectangle(100).positions);
  });

  it("keeps a triangle that only touches the world's edge whole", () => {
    // Ends exactly at x = 512, where the world ends.
    const mesh = rectangle(WORLD - 30);
    expect(clipMeshToWorld(mesh, WORLD)).toEqual(mesh);
  });

  describe("a mesh across the world's edge", () => {
    // From x = 500 to 530: 12 units in this world, 18 in the next.
    const mesh = rectangle(500);
    const clipped = clipMeshToWorld(mesh, WORLD);

    it("puts every vertex inside the world", () => {
      for (const x of xsOf(clipped)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(WORLD);
      }
    });

    it("draws a part at each edge of the world, meeting at the seam", () => {
      const xs = xsOf(clipped);
      expect(Math.min(...xs)).toBe(0);
      expect(Math.max(...xs)).toBe(WORLD);
      expect(xs.filter((x) => x > 400).every((x) => x >= 500)).toBe(true);
      expect(xs.filter((x) => x < 100).every((x) => x <= 18)).toBe(true);
    });

    it("covers the same area", () => {
      expect(area(clipped)).toBeCloseTo(area(mesh), 9);
    });

    it("interpolates UVs along the cut, as the GPU would", () => {
      // u runs from 0 at x = 500 to 1 at x = 530, in either part.
      for (let i = 0; i < clipped.positions.length; i += 2) {
        const x = clipped.positions[i]!;
        const unwrapped = x < 100 ? x + WORLD : x;
        expect(clipped.uvs[i]!).toBeCloseTo((unwrapped - 500) / 30, 9);
      }
    });
  });

  it("cuts a mesh across x = 0 and moves its west part forward a world", () => {
    // From x = −12 to 18.
    const clipped = clipMeshToWorld(rectangle(-12), WORLD);
    const xs = xsOf(clipped);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(WORLD);
    expect(area(clipped)).toBeCloseTo(area(rectangle(-12)), 9);
  });
});
