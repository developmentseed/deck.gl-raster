import { describe, expect, it } from "vitest";
import {
  barycentric,
  countTriangles,
  recordRefinement,
} from "../src/scene/refinement.js";
import {
  pixelToUtm,
  UTM_HEIGHT,
  UTM_TO_WEB_MERCATOR,
  UTM_WIDTH,
  utmToLngLat,
  WORLD_WIDTH,
} from "../src/scene/utm60n.js";

const SIZE = { width: UTM_WIDTH, height: UTM_HEIGHT };
const OPTIONS = { ...SIZE, maxError: 0.125, wrapX: WORLD_WIDTH };

describe("recordRefinement with wrapX", () => {
  const record = recordRefinement(UTM_TO_WEB_MERCATOR, OPTIONS);

  it("starts from the 2-triangle seed with under 2 px of error", () => {
    expect(record.seedTriangles.length).toBe(6);
    expect(record.seedMaxError).toBeCloseTo(1.78, 2);
  });

  it("matches the library's mesh at 0.125 px: 32 triangles", () => {
    const last = record.steps[record.steps.length - 1]!;
    expect(last.triangles.length / 3).toBe(32);
    expect(last.maxError).toBeLessThanOrEqual(0.125);
  });

  it("puts every vertex in the same world copy, continuous across 180°", () => {
    // True unwrapped x, from the longitude taken east of 0° (173°E–187°E).
    const trueX = (i: number) => {
      const [lng] = utmToLngLat(
        ...pixelToUtm(
          record.uvs[2 * i]! * UTM_WIDTH,
          record.uvs[2 * i + 1]! * UTM_HEIGHT,
        ),
      );
      return (((lng + 360) % 360) / 360) * WORLD_WIDTH;
    };
    const offset = record.positions[0]! - trueX(0);
    for (let i = 1; i < record.uvs.length / 2; i++) {
      expect(record.positions[2 * i]! - trueX(i)).toBeCloseTo(offset, 0);
    }
    const xs = record.positions.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs)).toBeGreaterThan(WORLD_WIDTH / 2);
  });

  it("records raw seed corners on both sides of the world", () => {
    const raw = Array.from(record.seedRawX);
    expect(raw[0]).toBeGreaterThan(0);
    expect(raw[1]).toBeLessThan(0);
    expect(raw[1]! + WORLD_WIDTH).toBeCloseTo(record.positions[2]!, 3);
  });

  it("replays unwrapAlong to each seed corner's unwrapped x", () => {
    expect(record.seedUnwraps.map((u) => [u.from, u.vertex])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    for (const { vertex, samples } of record.seedUnwraps) {
      expect(samples.map((s) => s.t)).toEqual([0.5, 1]);
      expect(samples[samples.length - 1]!.x).toBeCloseTo(
        record.positions[2 * vertex]!,
        3,
      );
    }
  });

  it("snaps each new vertex to its triangle's interpolated x", () => {
    for (const { split, vertex } of record.steps) {
      expect(split.refX).toBeCloseTo(split.guess[0], 3);
      const x = record.positions[2 * vertex]!;
      expect(Math.abs(x - split.refX)).toBeLessThan(WORLD_WIDTH / 4);
      const worlds = (x - split.rawX) / WORLD_WIDTH;
      expect(worlds).toBeCloseTo(Math.round(worlds), 9);
    }
  });

  it("splits at the worst of the triangle's 4 test points", () => {
    for (const { split } of record.steps) {
      expect(split.samples).toHaveLength(4);
      const worst = split.samples.reduce((a, b) => (b.error > a.error ? b : a));
      expect(worst.uv[0]).toBeCloseTo(split.uv[0], 12);
      expect(worst.uv[1]).toBeCloseTo(split.uv[1], 12);
      expect(worst.error).toBeCloseTo(split.error, 9);
    }
  });

  it("adds one vertex per step, with stable ids", () => {
    record.steps.forEach((step, k) => {
      expect(step.vertex).toBe(4 + k);
    });
    expect(record.positions.length).toBe(record.uvs.length);
  });

  it("stops after maxSteps", () => {
    const short = recordRefinement(UTM_TO_WEB_MERCATOR, {
      ...OPTIONS,
      maxSteps: 5,
    });
    expect(short.steps.length).toBe(5);
  });
});

describe("without wrapX", () => {
  it("leaves the seed with hundreds of pixels of error", () => {
    const record = recordRefinement(UTM_TO_WEB_MERCATOR, {
      ...SIZE,
      maxError: 0,
      maxSteps: 0,
    });
    expect(record.seedMaxError).toBeGreaterThan(400);
    expect(record.seedUnwraps).toEqual([]);
  });
});

describe("barycentric", () => {
  it("is a third each at the centroid", () => {
    for (const w of barycentric([1 / 3, 1 / 3], [0, 0], [1, 0], [0, 1])) {
      expect(w).toBeCloseTo(1 / 3, 10);
    }
  });
});

describe("countTriangles", () => {
  it("counts 32 triangles at the library default of 0.125 px", () => {
    expect(countTriangles(UTM_TO_WEB_MERCATOR, OPTIONS)).toBe(32);
  });
});
