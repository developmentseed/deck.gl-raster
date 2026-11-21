import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import type { ReprojectionFns } from "../src/delatin.js";
import { RasterReprojector, triangulateRectangle } from "../src/delatin.js";

const R = Math.PI * 6378137;
const to3857 = proj4("EPSG:4326", "EPSG:3857");

/**
 * An EPSG:4326 tile rendered to deck.gl's Web Mercator common space, like
 * `RasterLayer` does: 512x512 px spanning 45 degrees of longitude and latitude
 * up from `south`. Past 85.05 degrees the seed is clamped, like
 * `RasterTileset2D` does for Web Mercator.
 */
function tile(south: number): {
  fns: ReprojectionFns;
  seed?: ReturnType<typeof triangulateRectangle>;
} {
  const north = south + 45;
  const degPerPx = 45 / 512;
  const fns: ReprojectionFns = {
    forwardTransform: (px, py) => [px * degPerPx, north - py * degPerPx],
    inverseTransform: (x, y) => [x / degPerPx, (north - y) / degPerPx],
    forwardReproject: (x, y) => {
      const [mx, my] = to3857.forward([x, y]);
      return [(mx / (2 * R) + 0.5) * 512, (my / (2 * R) + 0.5) * 512];
    },
    inverseReproject: (cx, cy) =>
      to3857.inverse([(cx / 512 - 0.5) * 2 * R, (cy / 512 - 0.5) * 2 * R]),
  };
  const maxLat = 85.0511287798066;
  const seed =
    north > maxLat
      ? triangulateRectangle(0, (north - maxLat) / 45, 1, 1)
      : undefined;
  return { fns, seed };
}

/** Wrap each function to count calls and record the points it was given. */
function counted(fns: ReprojectionFns) {
  const calls: Record<keyof ReprojectionFns, number> = {
    forwardTransform: 0,
    inverseTransform: 0,
    forwardReproject: 0,
    inverseReproject: 0,
  };
  const points = new Map<string, number>();
  const wrapped = {} as ReprojectionFns;
  for (const name of Object.keys(calls) as (keyof ReprojectionFns)[]) {
    wrapped[name] = (x, y) => {
      calls[name]++;
      if (name === "forwardReproject" || name === "inverseReproject") {
        const key = `${x},${y}`;
        points.set(key, (points.get(key) ?? 0) + 1);
      }
      return fns[name](x, y);
    };
  }
  return { wrapped, calls, points };
}

describe("edge midpoint memo", () => {
  for (const space of ["output", "input"] as const) {
    it(`projects each edge midpoint once in ${space} mode (45-90N tile)`, () => {
      const { fns, seed } = tile(45);
      const { wrapped, calls, points } = counted(fns);
      const r = new RasterReprojector(wrapped, 513, 513, {
        initialTriangulation: seed,
        _errorSpace: space,
      });
      r.run(0.125);

      const triangles = r.triangles.length / 3;
      expect(triangles).toBeGreaterThan(1000);
      // Without the memo, every triangle measured costs 4 projections and the
      // mesh needs about 11 per triangle; with it, under 6.5.
      const projections = calls.forwardReproject + calls.inverseReproject;
      expect(projections / triangles).toBeLessThan(6.5);
      // Almost no point is projected twice; the few that are coincide by
      // construction (e.g. a centroid landing on another edge's midpoint).
      const repeated = [...points.values()].filter((n) => n > 1).length;
      expect(repeated / points.size).toBeLessThan(0.02);
    });
  }

  it("produces the same mesh as repeated projection would (determinism)", () => {
    const { fns, seed } = tile(0);
    const a = new RasterReprojector(fns, 513, 513, {
      initialTriangulation: seed,
      _errorSpace: "output",
    });
    const b = new RasterReprojector(fns, 513, 513, {
      initialTriangulation: seed,
      _errorSpace: "output",
    });
    a.run(0.125);
    b.run(0.125);
    expect(a.triangles).toEqual(b.triangles);
    expect(a.uvs).toEqual(b.uvs);
    expect(a.exactOutputPositions).toEqual(b.exactOutputPositions);
    expect(a.getMaxError()).toBeLessThanOrEqual(0.125);
  });
});
