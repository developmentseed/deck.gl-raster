import { describe, expect, it } from "vitest";
import {
  NLCD_HEIGHT,
  NLCD_TO_WEB_MERCATOR,
  NLCD_WIDTH,
} from "../src/scene/nlcd.js";
import {
  barycentric,
  countTriangles,
  recordRefinement,
} from "../src/scene/refinement.js";

const SIZE = { width: NLCD_WIDTH, height: NLCD_HEIGHT };

describe("recordRefinement", () => {
  const record = recordRefinement(NLCD_TO_WEB_MERCATOR, {
    ...SIZE,
    maxError: 4,
  });

  it("starts from the 2-triangle seed with ~261 px of error", () => {
    expect(record.seedTriangles.length).toBe(6);
    expect(record.seedMaxError).toBeCloseTo(260.9, 1);
  });

  it("matches the library's mesh at 4 px: 108 steps, 194 triangles", () => {
    expect(record.steps.length).toBe(108);
    const last = record.steps[record.steps.length - 1]!;
    expect(last.triangles.length / 3).toBe(194);
    expect(last.maxError).toBeLessThanOrEqual(4);
  });

  it("adds one vertex per step, with stable ids", () => {
    record.steps.forEach((step, k) => {
      expect(step.vertex).toBe(4 + k);
    });
    expect(record.uvs.length / 2).toBe(4 + record.steps.length);
    expect(record.positions.length).toBe(record.uvs.length);
  });

  it("splits the seed's diagonal at its midpoint first", () => {
    const first = record.steps[0]!.split;
    expect(first.uv).toEqual([0.5, 0.5]);
    expect(first.error).toBeCloseTo(260.9, 1);
    // Seed vertices: 0 = (0,0), 1 = (1,0), 2 = (0,1), 3 = (1,1). The diagonal
    // is 0–3, so the GPU's guess is the midpoint of their exact positions.
    const p = record.positions;
    expect(first.guess[0]).toBeCloseTo((p[0]! + p[6]!) / 2, 3);
    expect(first.guess[1]).toBeCloseTo((p[1]! + p[7]!) / 2, 3);
  });

  it("records the split triangle's index in the mesh before the split", () => {
    let before = record.seedTriangles;
    for (const step of record.steps.slice(0, 20)) {
      const { index, triangle } = step.split;
      expect(Array.from(before.subarray(3 * index, 3 * index + 3))).toEqual(
        triangle,
      );
      before = step.triangles;
    }
  });

  it("puts each new vertex at its split point", () => {
    for (const step of record.steps) {
      expect(record.uvs[2 * step.vertex]).toBe(step.split.uv[0]);
      expect(record.uvs[2 * step.vertex + 1]).toBe(step.split.uv[1]);
    }
  });

  it("stops after maxSteps", () => {
    const short = recordRefinement(NLCD_TO_WEB_MERCATOR, {
      ...SIZE,
      maxError: 4,
      maxSteps: 5,
    });
    expect(short.steps.length).toBe(5);
  });
});

describe("barycentric", () => {
  const a: [number, number] = [0, 0];
  const b: [number, number] = [1, 0];
  const c: [number, number] = [0, 1];

  it("is (1, 0, 0) at the first vertex", () => {
    expect(barycentric([0, 0], a, b, c)).toEqual([1, 0, 0]);
  });

  it("is a third each at the centroid", () => {
    for (const w of barycentric([1 / 3, 1 / 3], a, b, c)) {
      expect(w).toBeCloseTo(1 / 3, 10);
    }
  });
});

describe("countTriangles", () => {
  it("counts 6,001 triangles at the library default of 0.125 px", () => {
    expect(
      countTriangles(NLCD_TO_WEB_MERCATOR, { ...SIZE, maxError: 0.125 }),
    ).toBe(6001);
  });
});
