import { describe, expect, it } from "vitest";
import {
  NLCD_HEIGHT,
  NLCD_TO_WEB_MERCATOR,
  NLCD_WIDTH,
} from "../src/scene/nlcd.js";
import type { ErrorSample, RefinementRecord } from "../src/scene/refinement.js";
import {
  barycentric,
  countTriangles,
  recordRefinement,
} from "../src/scene/refinement.js";

const SIZE = { width: NLCD_WIDTH, height: NLCD_HEIGHT };

/** The seed's test point with the largest error. */
function worstSeedSample(record: RefinementRecord): ErrorSample {
  return record.seedSamples
    .flat()
    .reduce((a, b) => (b.error > a.error ? b : a));
}

describe.each(["source", "target"] as const)(
  "recordRefinement, error measured in %s space",
  (errorSpace) => {
    const record = recordRefinement(NLCD_TO_WEB_MERCATOR, {
      ...SIZE,
      maxError: 4,
      errorSpace,
    });

    it("stops at the tolerance", () => {
      const last = record.steps[record.steps.length - 1]!;
      expect(last.maxError).toBeLessThanOrEqual(4);
    });

    it("adds one vertex per step, with stable ids", () => {
      record.steps.forEach((step, k) => {
        expect(step.vertex).toBe(4 + k);
      });
      expect(record.uvs.length / 2).toBe(4 + record.steps.length);
      expect(record.positions.length).toBe(record.uvs.length);
    });

    it("splits at the worst of the triangle's 4 test points", () => {
      for (const { split } of record.steps) {
        expect(split.samples).toHaveLength(4);
        const worst = split.samples.reduce((a, b) =>
          b.error > a.error ? b : a,
        );
        expect(worst.uv[0]).toBeCloseTo(split.uv[0], 12);
        expect(worst.uv[1]).toBeCloseTo(split.uv[1], 12);
        expect(worst.error).toBeCloseTo(split.error, 9);
      }
    });

    it("scores every triangle, the largest score being the max error", () => {
      expect(Math.max(...record.seedScores)).toBeCloseTo(
        record.seedMaxError,
        3,
      );
      for (const step of record.steps) {
        expect(step.scores).toHaveLength(step.triangles.length / 3);
        expect(Math.max(...step.scores)).toBeCloseTo(step.maxError, 3);
      }
    });

    it("measures both seed triangles, the worst being the seed's error", () => {
      expect(record.seedSamples).toHaveLength(2);
      expect(worstSeedSample(record).error).toBeCloseTo(record.seedMaxError, 9);
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
        errorSpace,
      });
      expect(short.steps.length).toBe(5);
    });
  },
);

describe("recordRefinement, error measured in source pixels", () => {
  const record = recordRefinement(NLCD_TO_WEB_MERCATOR, {
    ...SIZE,
    maxError: 4,
  });

  it("starts from the 2-triangle seed with ~261 px of error", () => {
    expect(record.seedTriangles.length).toBe(6);
    expect(record.seedMaxError).toBeCloseTo(260.9, 1);
  });

  it("is worst at the seed's shared diagonal, the image center", () => {
    expect(worstSeedSample(record).uv).toEqual([0.5, 0.5]);
  });

  it("matches the library's mesh at 4 px: 108 steps, 194 triangles", () => {
    expect(record.steps.length).toBe(108);
    const last = record.steps[record.steps.length - 1]!;
    expect(last.triangles.length / 3).toBe(194);
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

  it("measures each error from the test point to its guess, mapped back", () => {
    for (const sample of record.seedSamples.flat()) {
      const dx = (sample.uv[0] - sample.sampled[0]) * NLCD_WIDTH;
      const dy = (sample.uv[1] - sample.sampled[1]) * NLCD_HEIGHT;
      expect(Math.hypot(dx, dy)).toBeCloseTo(sample.error, 6);
    }
  });
});

describe("recordRefinement, error measured on the map", () => {
  const record = recordRefinement(NLCD_TO_WEB_MERCATOR, {
    ...SIZE,
    maxError: 4,
    errorSpace: "target",
  });

  it("starts from the 2-triangle seed with ~279 px of error", () => {
    expect(record.seedMaxError).toBeCloseTo(279.0, 1);
  });

  it("is worst at the middle of the top edge, where the map stretches most", () => {
    expect(worstSeedSample(record).uv).toEqual([0.5, 0]);
  });

  it("matches the library's mesh at 4 px: 160 triangles", () => {
    const last = record.steps[record.steps.length - 1]!;
    expect(last.triangles.length / 3).toBe(160);
  });

  it("measures each error as its gap on the map over one pixel's size there", () => {
    // One source pixel's size on the map at the image center, as the
    // library measures it: the geometric mean of a step right and a step down.
    const f = (x: number, y: number) =>
      NLCD_TO_WEB_MERCATOR.forwardReproject(
        ...NLCD_TO_WEB_MERCATOR.forwardTransform(x, y),
      );
    const [cx, cy] = [NLCD_WIDTH / 2, NLCD_HEIGHT / 2];
    const c = f(cx, cy);
    const right = f(cx + 1, cy);
    const down = f(cx, cy + 1);
    const pixelSize = Math.sqrt(
      Math.hypot(right[0] - c[0], right[1] - c[1]) *
        Math.hypot(down[0] - c[0], down[1] - c[1]),
    );
    for (const sample of record.seedSamples.flat()) {
      const gap = Math.hypot(
        sample.exact[0] - sample.guess[0],
        sample.exact[1] - sample.guess[1],
      );
      expect(sample.error).toBeCloseTo(gap / pixelSize, 6);
    }
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

  it("counts 6,563 triangles at 0.125 px on the map", () => {
    expect(
      countTriangles(NLCD_TO_WEB_MERCATOR, {
        ...SIZE,
        maxError: 0.125,
        errorSpace: "target",
      }),
    ).toBe(6563);
  });
});
