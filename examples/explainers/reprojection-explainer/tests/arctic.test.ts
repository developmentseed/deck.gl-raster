import { describe, expect, it, vi } from "vitest";
import {
  ARCTIC_HEIGHT,
  ARCTIC_SCENARIO,
  ARCTIC_WIDTH,
  lngLatToPixel,
  pixelToLngLat,
} from "../src/scene/arctic.js";
import { bakedParallel, buildScene } from "../src/scene/build-scene.js";
import { countTriangles } from "../src/scene/refinement.js";

describe("Arctic georeferencing", () => {
  it("covers 85°N to 30°N and ±179.93°", () => {
    const [west, north] = pixelToLngLat(0, 0);
    const [east, south] = pixelToLngLat(ARCTIC_WIDTH, ARCTIC_HEIGHT);
    expect(west).toBeCloseTo(-179.9333, 3);
    expect(north).toBeCloseTo(85, 6);
    expect(east).toBeCloseTo(179.9333, 3);
    expect(south).toBeCloseTo(30, 6);
  });

  it("round-trips pixel → longitude/latitude → pixel", () => {
    const [x, y] = lngLatToPixel(...pixelToLngLat(1234.5, 67.25));
    expect(x).toBeCloseTo(1234.5, 9);
    expect(y).toBeCloseTo(67.25, 9);
  });

  it("bakes the Arctic Circle in as a straight row", () => {
    const rows = bakedParallel(ARCTIC_SCENARIO).map(([, y]) => y);
    expect(Math.max(...rows) - Math.min(...rows)).toBeLessThan(1e-9);
    expect(rows[0]).toBeCloseTo((85 - 66.5636) / (55 / ARCTIC_HEIGHT), 6);
  });
});

describe.each(["source", "target"] as const)(
  "Arctic scene, error measured in %s space",
  (errorSpace) => {
    for (const finalMaxError of ARCTIC_SCENARIO.maxErrorChoices) {
      it(`converges at ${finalMaxError} px`, () => {
        const { record } = buildScene({
          scenario: ARCTIC_SCENARIO,
          finalMaxError,
          errorSpace,
        });
        const last = record.steps[record.steps.length - 1]!;
        expect(last.maxError).toBeLessThanOrEqual(finalMaxError);
      });
    }

    it("counts its triangles at the library default to convergence", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        countTriangles(ARCTIC_SCENARIO.fns, {
          width: ARCTIC_WIDTH,
          height: ARCTIC_HEIGHT,
          maxError: 0.125,
          errorSpace,
        });
        // RasterReprojector warns when it stops before reaching the tolerance.
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("is worst at the middle of the bottom edge for the 2-triangle mesh", () => {
      const { record } = buildScene({
        scenario: ARCTIC_SCENARIO,
        finalMaxError: 32,
        errorSpace,
      });
      const worst = record.seedSamples
        .flat()
        .reduce((a, b) => (b.error > a.error ? b : a));
      // 0° longitude at 30°N: across the largest circle from the seam the
      // collapsed mesh lies on.
      expect(worst.uv).toEqual([0.5, 1]);
    });
  },
);
