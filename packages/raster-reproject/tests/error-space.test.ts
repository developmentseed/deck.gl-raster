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

describe("RasterReprojector _errorSpace", () => {
  it("defaults to input mode and leaves its meshes unchanged", () => {
    const r = new RasterReprojector(curved, 64, 64);
    r.run(0.125);
    // Recorded before output mode existed.
    expect(r.triangles.length / 3).toBe(1044);
    expect(r.uvs.length / 2).toBe(556);
    expect(r.getMaxError()).toBe(0.12306414842604596);
    const sum = r.exactOutputPositions.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(70599.57017345948, 9);
  });

  it("builds the default mesh when asked for input mode", () => {
    const byDefault = new RasterReprojector(curved, 64, 64);
    const input = new RasterReprojector(curved, 64, 64, {
      _errorSpace: "input",
    });
    byDefault.run(0.125);
    input.run(0.125);
    expect(input.triangles).toEqual(byDefault.triangles);
  });

  it("converges in output mode to the tolerance on the map", () => {
    // F(x, y) = (x², y): pixels widen across the tile, so the map needs more
    // accuracy on the right than input pixels would ask for.
    const widening: ReprojectionFns = {
      forwardTransform: identity,
      inverseTransform: identity,
      forwardReproject: (x, y) => [x * x, y],
      inverseReproject: (x, y) => [Math.sqrt(x), y],
    };
    const r = new RasterReprojector(widening, 64, 64, {
      _errorSpace: "output",
    });
    r.run(0.125);
    expect(r.uvs.length).toBeGreaterThan(8);
    // Score the finished mesh independently: at every test point, the
    // distance on the map between where it belongs and where the GPU draws
    // it, in units of the center pixel's size. The pixel centered on (31.5,
    // 31.5) spans 32² − 31² = 63 across and 1 down on the map.
    const pixelSize = Math.sqrt(63 * 1);
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

  it("never calls the inverse functions in output mode", () => {
    const fns = {
      ...curved,
      inverseTransform: throws,
      inverseReproject: throws,
    };
    const r = new RasterReprojector(fns, 64, 64, { _errorSpace: "output" });
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
    const r = new RasterReprojector(fns, size, size, { _errorSpace: "output" });
    const dy = size - 1;
    // The pixel centered on the center row y spans (s, 0) across and
    // (2·s·k·y, s) down on the map: a sheared pixel of area s².
    const pixelSize = s;
    expect(r.getMaxError()).toBeCloseTo((s * k * dy * dy) / 4 / pixelSize, 9);
  });

  it("measures a sheared pixel's size from its area on the map", () => {
    // F(x, y) = (x + y + k·y², y): a pixel spans (1, 0) across and
    // (1 + 2·k·y, 1) down on the map, a parallelogram of area 1, so the pixel
    // size is 1. The side lengths' geometric mean would be about 1.21.
    const k = 0.001;
    const size = 65;
    const sheared: ReprojectionFns = {
      forwardTransform: identity,
      inverseTransform: identity,
      forwardReproject: (x, y) => [x + y + k * y * y, y],
      inverseReproject: (x, y) => [x - y - k * y * y, y],
    };
    const r = new RasterReprojector(sheared, size, size, {
      _errorSpace: "output",
    });
    // Only k·y² bends: the seed's edges that span the full height miss by
    // k·dy²/4 at their midpoints, and nothing misses by more.
    const dy = size - 1;
    expect(r.getMaxError()).toBeCloseTo((k * dy * dy) / 4, 9);
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
      _errorSpace: "output",
      initialTriangulation: triangulateRectangle(0, 0, 0.5, 1),
    });
    // The seed spans u in [0, 0.5], so its center is at u = 0.25. The pixel
    // centered there spans (px + ½)² − (px − ½)² = 2·px across and 1 down.
    const px = 0.25 * 63;
    const pixelSize = Math.sqrt(2 * px);
    // The seed's horizontal edges and diagonal span 0.5 · 63 pixels in x; the
    // midpoint error of x² over a span d is d²/4.
    const dx = 0.5 * 63;
    expect(r.getMaxError()).toBeCloseTo((dx * dx) / 4 / pixelSize, 9);
  });

  it("projects each measured triangle's centroid, and each edge midpoint once", () => {
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
      _errorSpace: "output",
    });
    r.run(0.125);
    // 4 seed corners + 4 for the pixel size + the centroid of every measured
    // triangle, plus each edge midpoint the first time an edge is measured
    // (the memo serves it to the triangle on the other side and to rebuilds
    // after a flip); new vertices reuse their test point's projection.
    const measuredTriangles = measured.mock.calls.length;
    expect(forwardCalls).toBeGreaterThanOrEqual(8 + measuredTriangles);
    expect(forwardCalls).toBeLessThan(8 + 4 * measuredTriangles);
    measured.mockRestore();
  });

  it("reuses positions that equal a fresh projection", () => {
    const r = new RasterReprojector(curved, 64, 64, { _errorSpace: "output" });
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

  it("measures the pixel size elsewhere when the center pixel has no size", () => {
    // Flat in a band 4 px tall around the center row, and moved rigidly
    // elsewhere: the center pixel has no size on the map, and every pixel
    // outside the band is 1 x 1.
    const center = 31.5;
    const banded: ReprojectionFns = {
      forwardTransform: identity,
      inverseTransform: identity,
      forwardReproject: (x, y) => [
        x,
        Math.abs(y - center) <= 2 ? center : y - 2 * Math.sign(y - center),
      ],
      inverseReproject: throws,
    };
    const r = new RasterReprojector(banded, 64, 64, { _errorSpace: "output" });
    expect((r as unknown as { _pixelSize: number })._pixelSize).toBe(1);
  });

  it("meshes a polar tile whose center is past Web Mercator's latitude limit", () => {
    // North polar stereographic on a sphere, with the pole at the tile's
    // center, projected to Web Mercator with latitude clamped to its limit, as
    // RasterTileLayer does. Most of the tile, the center included, collapses
    // onto the map's top edge: only its corners are inside the limit.
    const R = 6378137;
    const metres = 1_000_000;
    const size = 256;
    const polar: ReprojectionFns = {
      forwardTransform: (px, py) => [
        (px / size - 0.5) * metres,
        (0.5 - py / size) * metres,
      ],
      inverseTransform: throws,
      forwardReproject: (x, y) => {
        const lng = (Math.atan2(x, -y) * 180) / Math.PI;
        const lat =
          90 - (2 * Math.atan(Math.hypot(x, y) / (2 * R)) * 180) / Math.PI;
        const phi = (Math.min(lat, 85.051129) * Math.PI) / 180;
        return [
          ((lng + 180) / 360) * 512,
          (0.5 + Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) *
            512,
        ];
      },
      inverseReproject: throws,
    };
    const r = new RasterReprojector(polar, size + 1, size + 1, {
      _errorSpace: "output",
    });
    const pixelSize = (r as unknown as { _pixelSize: number })._pixelSize;
    expect(Number.isFinite(pixelSize)).toBe(true);
    expect(pixelSize).toBeGreaterThan(0);
  });

  it("throws when no pixel in the meshed area has a size on the map", () => {
    const flat: ReprojectionFns = {
      ...curved,
      forwardReproject: () => [0, 0],
    };
    expect(
      () => new RasterReprojector(flat, 64, 64, { _errorSpace: "output" }),
    ).toThrow(/_errorSpace "output"/);
  });

  it("works on a one-pixel tile", () => {
    // The pixel-size steps land outside a 2×2 mesh; output mode must still
    // measure (and never fall back to the inverse functions).
    const fns = {
      ...curved,
      inverseTransform: throws,
      inverseReproject: throws,
    };
    const r = new RasterReprojector(fns, 2, 2, { _errorSpace: "output" });
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
    const r = new RasterReprojector(holed, 64, 64, { _errorSpace: "output" });
    expect(() => r.run(0.125, { maxIterations: 3000 })).not.toThrow();
    for (let i = 4; i < r.uvs.length / 2; i++) {
      expect(Number.isFinite(r.exactOutputPositions[2 * i])).toBe(true);
    }
  });
});
