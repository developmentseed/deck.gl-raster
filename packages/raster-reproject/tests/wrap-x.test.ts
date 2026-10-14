import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import type { ReprojectionFns } from "../src/delatin.js";
import { RasterReprojector } from "../src/delatin.js";
import { unwrapAlong } from "../src/index.js";

/** One world width in deck.gl's common space. */
const WORLD = 512;

const throws = (): [number, number] => {
  throw new Error("inverse called");
};

/**
 * Longitude/latitude to Web Mercator in deck.gl's common space. Like proj4,
 * it wraps longitude into [−180°, 180°], so a point past 180° comes back on
 * the far side of the world.
 */
function lngLatToCommon(lng: number, lat: number): [number, number] {
  const wrapped = Math.abs(lng) <= 180 ? lng : lng - Math.sign(lng) * 360;
  const phi = (lat * Math.PI) / 180;
  return [
    ((wrapped + 180) / 360) * WORLD,
    (0.5 + Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * WORLD,
  ];
}

type Bounds = { west: number; south: number; east: number; north: number };

/**
 * Mesh a north-up longitude/latitude image of `width`×`height` pixels into
 * Web Mercator, the way `RasterLayer` does: `width + 1` by `height + 1`, in
 * output mode, with one world as `wrapX` unless overridden.
 */
function mesh(
  { west, south, east, north }: Bounds,
  options: { width?: number; height?: number; wrapX?: number | null } = {},
): RasterReprojector {
  const { width = 64, height = 64, wrapX = WORLD } = options;
  const fns: ReprojectionFns = {
    forwardTransform: (px, py) => [
      west + (px / width) * (east - west),
      north - (py / height) * (north - south),
    ],
    inverseTransform: throws,
    forwardReproject: lngLatToCommon,
    inverseReproject: throws,
  };
  const r = new RasterReprojector(fns, width + 1, height + 1, {
    _errorSpace: "output",
    wrapX: wrapX ?? undefined,
  });
  r.run(0.125);
  return r;
}

const xsOf = (r: RasterReprojector) =>
  r.exactOutputPositions.filter((_, i) => i % 2 === 0);

/** The widest x range of any one triangle. */
function widestTriangle(r: RasterReprojector): number {
  const p = r.exactOutputPositions;
  let widest = 0;
  for (let i = 0; i < r.triangles.length; i += 3) {
    const xs = [0, 1, 2].map((j) => p[2 * r.triangles[i + j]!]!);
    widest = Math.max(widest, Math.max(...xs) - Math.min(...xs));
  }
  return widest;
}

describe("unwrapAlong", () => {
  it("returns the end value when the path doesn't wrap", () => {
    const valueAt = (t: number) => 100 + 50 * t;
    expect(unwrapAlong(valueAt, { start: 100, period: WORLD })).toBe(150);
  });

  it("follows a path across the wrap", () => {
    // From 500 to 540, but the values wrap back to 0 at 512.
    const valueAt = (t: number) => (500 + 40 * t) % WORLD;
    expect(unwrapAlong(valueAt, { start: 500, period: WORLD })).toBeCloseTo(
      540,
      9,
    );
  });

  it("follows a path west across the wrap", () => {
    // From 10 to −30, but the values wrap up to 512 below 0.
    const valueAt = (t: number) => (((10 - 40 * t) % WORLD) + WORLD) % WORLD;
    expect(unwrapAlong(valueAt, { start: 10, period: WORLD })).toBeCloseTo(
      -30,
      9,
    );
  });

  it("stays in the copy of a start outside the first world", () => {
    const valueAt = (t: number) => (100 + 50 * t) % WORLD;
    const start = 100 + 2 * WORLD;
    expect(unwrapAlong(valueAt, { start, period: WORLD })).toBeCloseTo(
      150 + 2 * WORLD,
      9,
    );
  });

  it("ends a whole period away when the path goes once around", () => {
    // Both ends wrap to 0, like the two edges of a 360°-wide image.
    const valueAt = (t: number) => (WORLD * t) % WORLD;
    expect(unwrapAlong(valueAt, { start: 0, period: WORLD })).toBeCloseTo(
      WORLD,
      9,
    );
  });
});

describe("RasterReprojector wrapX", () => {
  // The extent of the antimeridian.tif fixture: 42° wide, crossing −180°.
  const crossing: Bounds = { west: -204, south: -18, east: -162, north: 24 };
  // The same image moved 60° east, off the seam.
  const offSeam: Bounds = { west: -144, south: -18, east: -102, north: 24 };

  it("meshes an image that crosses 180° like the same image off the seam", () => {
    const a = mesh(crossing);
    const b = mesh(offSeam);
    expect(a.getMaxError()).toBeLessThanOrEqual(0.125);
    expect(a.triangles).toEqual(b.triangles);
    expect(a.uvs).toEqual(b.uvs);
    // Every vertex is the same distance apart in x, and at the same y.
    const shift = a.exactOutputPositions[0]! - b.exactOutputPositions[0]!;
    a.exactOutputPositions.forEach((value, i) => {
      const expected = b.exactOutputPositions[i]! + (i % 2 === 0 ? shift : 0);
      expect(value).toBeCloseTo(expected, 9);
    });
  });

  it("keeps the image the short way across the antimeridian", () => {
    const r = mesh(crossing);
    const xs = xsOf(r);
    // 42° of longitude, not the 318° the long way around.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(
      (42 / 360) * WORLD,
      9,
    );
    expect(widestTriangle(r)).toBeLessThan(WORLD / 2);
  });

  it("leaves an image that doesn't cross 180° unchanged", () => {
    const plain = mesh(offSeam, { wrapX: null });
    const wrapped = mesh(offSeam);
    expect(wrapped.triangles).toEqual(plain.triangles);
    expect(wrapped.exactOutputPositions).toEqual(plain.exactOutputPositions);
  });

  it("keeps an image that goes once around the world a world wide", () => {
    // Its two edges, 0° and 360°, come back from the projection at the same x.
    const r = mesh(
      { west: 0, south: 0, east: 360, north: 60 },
      { width: 72, height: 12 },
    );
    expect(r.getMaxError()).toBeLessThanOrEqual(0.125);
    // From 0° at x = 256, east to 360° one world later.
    const xs = xsOf(r);
    expect(Math.min(...xs)).toBeCloseTo(WORLD / 2, 9);
    expect(Math.max(...xs)).toBeCloseTo(WORLD / 2 + WORLD, 9);
  });

  it("measures the pixel size of an image centered on the seam", () => {
    // The 0..360° image's center is on 180°, so its half-pixel steps
    // straddle the seam. It should mesh like the −180..180° image.
    const size = { width: 72, height: 12 };
    const centeredOnSeam = mesh(
      { west: 0, south: 0, east: 360, north: 60 },
      size,
    );
    const centeredOnZero = mesh(
      { west: -180, south: 0, east: 180, north: 60 },
      size,
    );
    expect(centeredOnSeam.getMaxError()).toBeLessThanOrEqual(0.125);
    expect(centeredOnSeam.triangles.length).toBe(
      centeredOnZero.triangles.length,
    );
  });

  it("meshes a UTM zone 60 image across its curved seam", () => {
    // 200 km east of the zone's central meridian (177°E), 180° runs through
    // the image as a curve.
    const utmToLngLat = proj4(
      "+proj=utm +zone=60 +datum=WGS84 +units=m +no_defs",
      "EPSG:4326",
    );
    const [west, south, east, north] = [600_000, 5_800_000, 800_000, 6_000_000];
    const width = 64;
    const height = 64;
    const fns: ReprojectionFns = {
      forwardTransform: (px, py) => [
        west + (px / width) * (east - west),
        north - (py / height) * (north - south),
      ],
      inverseTransform: throws,
      forwardReproject: (x, y) =>
        lngLatToCommon(...utmToLngLat.forward<[number, number]>([x, y])),
      inverseReproject: throws,
    };
    const r = new RasterReprojector(fns, width + 1, height + 1, {
      _errorSpace: "output",
      wrapX: WORLD,
    });
    r.run(0.125);
    expect(r.getMaxError()).toBeLessThanOrEqual(0.125);
    // In one piece, across one edge of the world (x = 0 or 512).
    const xs = xsOf(r);
    expect(Math.floor(Math.max(...xs) / WORLD)).toBe(
      Math.floor(Math.min(...xs) / WORLD) + 1,
    );
    expect(widestTriangle(r)).toBeLessThan(WORLD / 2);
  });

  it("throws without output mode", () => {
    const fns: ReprojectionFns = {
      forwardTransform: (x, y) => [x, y],
      inverseTransform: throws,
      forwardReproject: lngLatToCommon,
      inverseReproject: throws,
    };
    expect(() => new RasterReprojector(fns, 9, 9, { wrapX: WORLD })).toThrow(
      /wrapX/,
    );
  });
});

describe("RasterReprojector wrapX around a pole", () => {
  // A quarter of an Antarctic polar stereographic grid, with the South Pole at
  // its top left corner and the 180° meridian down its left edge.
  const polarToLngLat = proj4(
    "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
    "EPSG:4326",
  );
  const size = 256;
  const metres = 3_000_000;
  const fns: ReprojectionFns = {
    forwardTransform: (px, py) => [(px / size) * metres, -(py / size) * metres],
    inverseTransform: throws,
    forwardReproject: (x, y) => {
      const [lng, lat] = polarToLngLat.forward<[number, number]>([x, y]);
      return lngLatToCommon(lng, Math.max(lat, -85.05112878));
    },
    inverseReproject: throws,
  };

  it("meshes a tile with the pole at a corner as it would without wrapX", () => {
    const options = { _errorSpace: "output" as const };
    const plain = new RasterReprojector(fns, size + 1, size + 1, options);
    const wrapped = new RasterReprojector(fns, size + 1, size + 1, {
      ...options,
      wrapX: WORLD,
    });
    plain.run(0.125, { maxIterations: 2000 });
    wrapped.run(0.125, { maxIterations: 2000 });
    expect(wrapped.triangles).toEqual(plain.triangles);
    expect(wrapped.exactOutputPositions).toEqual(plain.exactOutputPositions);
  });
});

describe("RasterReprojector wrapX validation", () => {
  const fns: ReprojectionFns = {
    forwardTransform: (x, y) => [x, y],
    inverseTransform: throws,
    forwardReproject: lngLatToCommon,
    inverseReproject: throws,
  };

  for (const wrapX of [0, -WORLD, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`throws for a period of ${wrapX}`, () => {
      expect(
        () =>
          new RasterReprojector(fns, 9, 9, { _errorSpace: "output", wrapX }),
      ).toThrow(/wrapX/);
    });
  }
});
