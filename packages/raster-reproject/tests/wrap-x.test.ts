import { describe, expect, it } from "vitest";
import type { ReprojectionFns } from "../src/delatin.js";
import { RasterReprojector, snapToCopy, unwrapAlong } from "../src/delatin.js";

const WORLD = 512;
const SIZE = 42;

/** Longitude → common-space x, unwrapped (no modulo). */
const lngToX = (lng: number) => ((lng + 180) / 360) * WORLD;
/** What proj4 does on the way to 3857: wrap into one world. */
const wrap = (x: number) => ((x % WORLD) + WORLD) % WORLD;

/**
 * Mimics a *projected* source CRS: source space is pixel space (continuous
 * across the seam), the forward-to-common-space wraps like proj4's, and the
 * inverse is periodic-safe (proj4's `adjlon` against the central meridian),
 * so any copy of x maps back to the right source point. `lngAt` sets the
 * seam shape.
 */
function fns(
  lngAt: (px: number, py: number) => number,
  { adjlon = true } = {},
): ReprojectionFns {
  const identity = (x: number, y: number): [number, number] => [x, y];
  return {
    forwardTransform: identity,
    inverseTransform: identity,
    forwardReproject: (px, py) => [wrap(lngToX(lngAt(px, py))), py],
    inverseReproject: (x, py) => {
      const centralLng = lngAt(SIZE / 2, py);
      const rawLng = (x / WORLD) * 360 - 180;
      const lng = adjlon ? snapToCopy(rawLng, centralLng, 360) : rawLng;
      // lngAt is monotonic in px along a row: invert by bisection.
      let lo = -SIZE;
      let hi = 2 * SIZE;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (lngAt(mid, py) < lng) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      return [(lo + hi) / 2, py];
    },
  };
}

const SHAPES: Record<string, (px: number, py: number) => number> = {
  // antimeridian.tif: lng −204..−162, seam at column 24.
  vertical: (px) => -204 + px,
  // Rotated geotransform: the seam is a straight slanted line.
  slanted: (px, py) => -204 + px + 0.4 * py,
  // Curved meridian (UTM-like): seam position varies nonlinearly by row.
  curved: (px, py) => -204 + px * (1 + 0.004 * py) + 0.01 * py * py,
  // A full 360° tile: both corners wrap to the same x.
  "world-spanning": (px) => -180 + (px * 360) / SIZE,
};

// A 360° tile's edges are one period apart, so a central-meridian `adjlon`
// inverse can't tell them apart; model it as a native lng/lat source (inverse
// passes the unwrapped lng straight through, like proj4 4326→4326).
const NATIVE_INVERSE = new Set(["world-spanning"]);

describe("RasterReprojector wrapX", () => {
  for (const [name, lngAt] of Object.entries(SHAPES)) {
    it(`unwraps a ${name} seam into one continuous mesh`, () => {
      const projection = fns(lngAt, { adjlon: !NATIVE_INVERSE.has(name) });
      const r = new RasterReprojector(projection, SIZE + 1, SIZE + 1, {
        wrapX: WORLD,
      });
      r.run(0.125);
      expect(r.getMaxError()).toBeLessThanOrEqual(0.125);

      // Every vertex sits in the same world copy as vertex 0, i.e. the mesh
      // is the true unwrapped geometry shifted by one constant k·WORLD.
      const offsetOf = (i: number) => {
        const lng = lngAt(r.uvs[2 * i]! * SIZE, r.uvs[2 * i + 1]! * SIZE);
        return r.exactOutputPositions[2 * i]! - lngToX(lng);
      };
      const offset = offsetOf(0);
      expect(
        Math.abs(offset / WORLD - Math.round(offset / WORLD)),
      ).toBeLessThan(1e-9);
      for (let i = 1; i < r.uvs.length / 2; i++) {
        expect(offsetOf(i)).toBeCloseTo(offset, 6);
      }
    });
  }

  it("leaves output untouched when wrapX is unset", () => {
    const r = new RasterReprojector(fns(SHAPES.vertical!), SIZE + 1);
    for (let i = 0; i < r.uvs.length / 2; i++) {
      const x = r.exactOutputPositions[2 * i]!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(WORLD);
    }
  });
});

describe("snapToCopy / unwrapAlong", () => {
  it("snaps to the copy nearest the reference", () => {
    expect(snapToCopy(5, 510, WORLD)).toBe(517);
    expect(snapToCopy(510, 5, WORLD)).toBe(-2);
    expect(snapToCopy(100, 120, WORLD)).toBe(100);
  });

  it("resolves endpoints exactly one period apart by walking the path", () => {
    // x goes 0 → 512 continuously, but the raw end value wraps to 0.
    const xAt = (t: number) => wrap(t * WORLD);
    expect(unwrapAlong(xAt, 0, WORLD)).toBeCloseTo(WORLD, 9);
  });
});
