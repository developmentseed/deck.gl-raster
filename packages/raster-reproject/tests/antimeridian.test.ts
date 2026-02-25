import { describe, expect, it } from "vitest";
import type { ReprojectionFns } from "../src/delatin";
import { RasterReprojector } from "../src/delatin";

/** Wrap a longitude to [-180, 180] */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Create ReprojectionFns that simulate a raster tile in a source CRS where
 * the forward transform produces coordinates in source CRS space, and
 * forwardReproject converts them to WGS84 with longitude wrapping (as proj4
 * does for geographic output CRS).
 */
function makeReprojectionFns(
  originX: number,
  originY: number,
  pixelSizeX: number,
  pixelSizeY: number,
  opts?: { wrapLongitude?: boolean },
): ReprojectionFns {
  const wrap = opts?.wrapLongitude ?? false;
  return {
    forwardTransform(pixelX: number, pixelY: number): [number, number] {
      return [
        originX + pixelX * pixelSizeX,
        originY + pixelY * pixelSizeY,
      ];
    },
    inverseTransform(crsX: number, crsY: number): [number, number] {
      return [
        (crsX - originX) / pixelSizeX,
        (crsY - originY) / pixelSizeY,
      ];
    },
    forwardReproject(x: number, y: number): [number, number] {
      // Simulate proj4 behavior: wrap longitude to [-180, 180]
      return wrap ? [wrapLng(x), y] : [x, y];
    },
    inverseReproject(x: number, y: number): [number, number] {
      // Identity inverse — extended longitudes (>180) pass through
      // unchanged, matching how proj4 handles inverse projection
      // (proj4 normalizes longitude internally before inverse-projecting)
      return [x, y];
    },
  };
}

describe("antimeridian detection", () => {
  it("does not flag a tile that does not cross the antimeridian", () => {
    // A tile centered around longitude 0, latitude 45
    const fns = makeReprojectionFns(-10, 40, 0.1, -0.05, {
      wrapLongitude: true,
    });
    const reprojector = new RasterReprojector(fns, 200, 200);
    expect(reprojector.crossesAntimeridian).toBe(false);
  });

  it("flags a tile that crosses the antimeridian", () => {
    // Tile spans from 170° to 190° in source CRS.
    // With wrapLongitude=true, forwardReproject wraps 190° → -170°,
    // so corner longitudes are [170, -170] — a 340° range that triggers
    // antimeridian detection.
    const fns = makeReprojectionFns(170, 40, 0.1, -0.05, {
      wrapLongitude: true,
    });
    const reprojector = new RasterReprojector(fns, 200, 200);
    expect(reprojector.crossesAntimeridian).toBe(true);
  });

  it("normalizes longitudes to continuous range when crossing antimeridian", () => {
    const fns = makeReprojectionFns(170, 40, 0.1, -0.05, {
      wrapLongitude: true,
    });
    const reprojector = new RasterReprojector(fns, 200, 200);
    reprojector.run(0.5);

    // All longitudes should be in [170, 190] — no jumps to negative values
    for (let i = 0; i < reprojector.exactOutputPositions.length; i += 2) {
      const lng = reprojector.exactOutputPositions[i]!;
      expect(lng).toBeGreaterThanOrEqual(170 - 0.1);
      expect(lng).toBeLessThanOrEqual(190 + 0.1);
    }
  });

  it("mesh triangles do not span more than 180 degrees of longitude", () => {
    const fns = makeReprojectionFns(170, 40, 0.1, -0.05, {
      wrapLongitude: true,
    });
    const reprojector = new RasterReprojector(fns, 200, 200);
    reprojector.run(0.5);

    const { triangles, exactOutputPositions } = reprojector;
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t]!;
      const b = triangles[t + 1]!;
      const c = triangles[t + 2]!;

      const lngA = exactOutputPositions[a * 2]!;
      const lngB = exactOutputPositions[b * 2]!;
      const lngC = exactOutputPositions[c * 2]!;

      const maxLng = Math.max(lngA, lngB, lngC);
      const minLng = Math.min(lngA, lngB, lngC);
      expect(maxLng - minLng).toBeLessThan(180);
    }
  });

  it("does not affect tiles far from the antimeridian", () => {
    // A tile centered at longitude 0, no wrapping needed
    const fns = makeReprojectionFns(-10, 40, 0.1, -0.05, {
      wrapLongitude: true,
    });
    const reprojector = new RasterReprojector(fns, 200, 200);
    reprojector.run(0.5);

    expect(reprojector.crossesAntimeridian).toBe(false);
    // All longitudes should be in [-10, 10]
    for (let i = 0; i < reprojector.exactOutputPositions.length; i += 2) {
      const lng = reprojector.exactOutputPositions[i]!;
      expect(lng).toBeGreaterThanOrEqual(-10 - 0.1);
      expect(lng).toBeLessThanOrEqual(10 + 0.1);
    }
  });
});
