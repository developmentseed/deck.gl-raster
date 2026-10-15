import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { RasterReprojector } from "@developmentseed/raster-reproject";
import { describe, expect, it } from "vitest";
import { makeUnwrappedReprojectionFns } from "../src/make-unwrapped-reprojection-fns.js";

/** One world width in deck.gl's common space. */
const WORLD = 512;

/**
 * Longitude/latitude to Web Mercator in deck.gl's common space. Like proj4,
 * it wraps longitude into [-180°, 180°], so a point past 180° comes back on
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

const throws = (): [number, number] => {
  throw new Error("inverse reprojection called");
};

type Bounds = { west: number; south: number; east: number; north: number };

/**
 * Mesh a north-up longitude/latitude image of `width`x`height` pixels into
 * Web Mercator, the way `RasterLayer` does: `width + 1` by `height + 1`, in
 * output mode, through {@link makeUnwrappedReprojectionFns} unless `unwrap`
 * is false.
 */
function mesh(
  { west, south, east, north }: Bounds,
  options: { width?: number; height?: number; unwrap?: boolean } = {},
): RasterReprojector {
  const { width = 64, height = 64, unwrap = true } = options;
  const dx = (east - west) / width;
  const dy = (north - south) / height;
  const fns: ReprojectionFns = {
    forwardTransform: (px, py) => [west + px * dx, north - py * dy],
    inverseTransform: (x, y) => [(x - west) / dx, (north - y) / dy],
    forwardReproject: lngLatToCommon,
    inverseReproject: throws,
  };
  const r = new RasterReprojector(
    unwrap
      ? makeUnwrappedReprojectionFns(fns, { width, height, period: WORLD })
      : fns,
    width + 1,
    height + 1,
    { _errorSpace: "output" },
  );
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

describe("makeUnwrappedReprojectionFns", () => {
  // The extent of the antimeridian.tif fixture: 42° wide, crossing -180°.
  const crossing: Bounds = { west: -204, south: -18, east: -162, north: 24 };
  // The same image moved 60° east, off the seam.
  const offSeam: Bounds = { west: -144, south: -18, east: -102, north: 24 };

  it("meshes an image that crosses 180° like the same image off the seam", () => {
    const a = mesh(crossing);
    const b = mesh(offSeam, { unwrap: false });
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
    const plain = mesh(offSeam, { unwrap: false });
    const unwrapped = mesh(offSeam);
    expect(unwrapped.triangles).toEqual(plain.triangles);
    expect(unwrapped.exactOutputPositions).toEqual(plain.exactOutputPositions);
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
    // The 0..360° image's center is on 180°, so the reprojector's half-pixel
    // steps there straddle the seam. It should mesh like the -180..180° image.
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
});
