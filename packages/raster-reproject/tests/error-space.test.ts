import { describe, expect, it, vi } from "vitest";
import type { ReprojectionFns } from "../src/delatin.js";
import { RasterReprojector, triangulateRectangle } from "../src/delatin.js";

const identity = (x: number, y: number): [number, number] => [x, y];

// Identity geotransform; a reprojection that bends in y, so linear
// interpolation has real error and the mesh must subdivide.
const curved: ReprojectionFns = {
  forwardTransform: identity,
  inverseTransform: identity,
  forwardReproject: (x, y) => [x + 0.05 * y * y, y],
  inverseReproject: (x, y) => [x - 0.05 * y * y, y],
};

const throws = (): [number, number] => {
  throw new Error("inverse called");
};

describe("RasterReprojector errorSpace", () => {
  it("defaults to source mode and leaves its meshes unchanged", () => {
    const r = new RasterReprojector(curved, 64, 64);
    r.run(0.125);
    // Recorded before target mode existed.
    expect(r.triangles.length / 3).toBe(1044);
    expect(r.uvs.length / 2).toBe(556);
    expect(r.getMaxError()).toBe(0.12306414842604596);
    const sum = r.exactOutputPositions.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(70599.57017345948, 9);
  });

  it("converges in target mode to the tolerance on the map", () => {
    // F(x, y) = (x², y): pixels widen across the tile, so the map needs more
    // accuracy on the right than source pixels would ask for.
    const widening: ReprojectionFns = {
      forwardTransform: identity,
      inverseTransform: identity,
      forwardReproject: (x, y) => [x * x, y],
      inverseReproject: (x, y) => [Math.sqrt(x), y],
    };
    const r = new RasterReprojector(widening, 64, 64, {
      errorSpace: "target",
    });
    r.run(0.125);
    expect(r.uvs.length).toBeGreaterThan(8);
    // Score the finished mesh independently: at every test point, the
    // distance on the map between where it belongs and where the GPU draws
    // it, in units of the center pixel's size. One pixel right of the center
    // (31.5, 31.5) moves 32.5² − 31.5² = 64; one pixel down moves 1.
    const pixelSize = Math.sqrt(64 * 1);
    const { uvs, exactOutputPositions: out, triangles } = r;
    let worst = 0;
    for (let t = 0; t < triangles.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((j) => 2 * triangles[t + j]!) as [
        number,
        number,
        number,
      ];
      for (const [w0, w1, w2] of [
        [1 / 3, 1 / 3, 1 / 3],
        [0.5, 0.5, 0],
        [0.5, 0, 0.5],
        [0, 0.5, 0.5],
      ] as const) {
        const px = (w0 * uvs[a]! + w1 * uvs[b]! + w2 * uvs[c]!) * 63;
        const py =
          (w0 * uvs[a + 1]! + w1 * uvs[b + 1]! + w2 * uvs[c + 1]!) * 63;
        const gx = w0 * out[a]! + w1 * out[b]! + w2 * out[c]!;
        const gy = w0 * out[a + 1]! + w1 * out[b + 1]! + w2 * out[c + 1]!;
        const [ex, ey] = widening.forwardReproject(px, py);
        worst = Math.max(worst, Math.hypot(ex - gx, ey - gy) / pixelSize);
      }
    }
    expect(r.getMaxError()).toBeLessThanOrEqual(0.125);
    expect(worst).toBeLessThanOrEqual(0.125 + 1e-12);
  });

  it("never calls the inverse functions in target mode", () => {
    const fns = {
      ...curved,
      inverseTransform: throws,
      inverseReproject: throws,
    };
    const r = new RasterReprojector(fns, 64, 64, { errorSpace: "target" });
    expect(() => r.run(0.125)).not.toThrow();
  });

  it("measures error on the map, in units of the center pixel's size", () => {
    // F(x, y) = s·(x + k·y², y) is linear in x and bends in y. Along an edge
    // whose ends are Δy apart, the GPU's straight line misses the curve at the
    // midpoint by s·k·Δy²/4 on the map. The seed's diagonal and vertical edges
    // span the full height.
    const s = 2;
    const k = 0.001;
    const size = 65;
    const fns: ReprojectionFns = {
      forwardTransform: identity,
      inverseTransform: identity,
      forwardReproject: (x, y) => [s * (x + k * y * y), s * y],
      inverseReproject: (x, y) => [x / s - k * (y / s) ** 2, y / s],
    };
    const r = new RasterReprojector(fns, size, size, { errorSpace: "target" });
    const dy = size - 1;
    const cy = (size - 1) / 2;
    // One pixel right of the center moves s; one pixel down moves
    // s·hypot(k·(2·cy + 1), 1). The pixel size is their geometric mean.
    const pixelSize = Math.sqrt(s * s * Math.hypot(k * (2 * cy + 1), 1));
    expect(r.getMaxError()).toBeCloseTo((s * k * dy * dy) / 4 / pixelSize, 9);
  });

  it("measures the pixel size at the center of the seed's UV bounds", () => {
    // F(x, y) = (x², y): a pixel's width on the map grows with x.
    const fns: ReprojectionFns = {
      forwardTransform: identity,
      inverseTransform: identity,
      forwardReproject: (x, y) => [x * x, y],
      inverseReproject: (x, y) => [Math.sqrt(x), y],
    };
    const r = new RasterReprojector(fns, 64, 64, {
      errorSpace: "target",
      initialTriangulation: triangulateRectangle(0, 0, 0.5, 1),
    });
    // The seed spans u in [0, 0.5], so its center is at u = 0.25.
    const px = 0.25 * 63;
    const pixelSize = Math.sqrt((px + 1) ** 2 - px ** 2);
    // The seed's horizontal edges and diagonal span 0.5 · 63 pixels in x; the
    // midpoint error of x² over a span d is d²/4.
    const dx = 0.5 * 63;
    expect(r.getMaxError()).toBeCloseTo((dx * dx) / 4 / pixelSize, 9);
  });

  it("makes one forward projection per test point, plus seven", () => {
    let forwardCalls = 0;
    const counting: ReprojectionFns = {
      ...curved,
      forwardReproject: (x, y) => {
        forwardCalls++;
        return curved.forwardReproject(x, y);
      },
    };
    const measured = vi.spyOn(
      RasterReprojector.prototype as unknown as {
        _findReprojectionCandidate: (t: number) => void;
      },
      "_findReprojectionCandidate",
    );
    const r = new RasterReprojector(counting, 64, 64, {
      errorSpace: "target",
    });
    r.run(0.125);
    // 4 seed corners + 3 for the pixel size + 4 test points per measured
    // triangle; new vertices reuse their test point's projection.
    expect(forwardCalls).toBe(7 + 4 * measured.mock.calls.length);
    measured.mockRestore();
  });

  it("reuses positions that equal a fresh projection", () => {
    const r = new RasterReprojector(curved, 64, 64, { errorSpace: "target" });
    r.run(0.125);
    for (let i = 0; i < r.uvs.length / 2; i++) {
      const [x, y] = curved.forwardReproject(
        r.uvs[2 * i]! * 63,
        r.uvs[2 * i + 1]! * 63,
      );
      expect(r.exactOutputPositions[2 * i]).toBe(x);
      expect(r.exactOutputPositions[2 * i + 1]).toBe(y);
    }
  });

  it("throws when the center pixel has no size on the map", () => {
    const flat: ReprojectionFns = {
      ...curved,
      forwardReproject: () => [0, 0],
    };
    expect(
      () => new RasterReprojector(flat, 64, 64, { errorSpace: "target" }),
    ).toThrow(/errorSpace "target"/);
  });

  it("works on a one-pixel tile", () => {
    // The pixel-size steps land outside a 2×2 mesh; target mode must still
    // measure (and never fall back to the inverse functions).
    const fns = {
      ...curved,
      inverseTransform: throws,
      inverseReproject: throws,
    };
    const r = new RasterReprojector(fns, 2, 2, { errorSpace: "target" });
    expect(() => r.run(0.125)).not.toThrow();
  });

  it("ignores test points the projection can't place, and adds only finite vertices", () => {
    // Undefined in a thin band of columns: some test points are NaN.
    const holed: ReprojectionFns = {
      ...curved,
      forwardReproject: (x, y) =>
        x > 20 && x < 21
          ? [Number.NaN, Number.NaN]
          : curved.forwardReproject(x, y),
    };
    const r = new RasterReprojector(holed, 64, 64, { errorSpace: "target" });
    expect(() => r.run(0.125, { maxIterations: 3000 })).not.toThrow();
    for (let i = 4; i < r.uvs.length / 2; i++) {
      expect(Number.isFinite(r.exactOutputPositions[2 * i])).toBe(true);
    }
  });
});
