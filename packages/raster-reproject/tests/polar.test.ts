import { describe, expect, it } from "vitest";
import type { ReprojectionFns } from "../src/delatin";
import { RasterReprojector } from "../src/delatin";

const R = 6378137; // WGS84 semi-major axis (meters)

/**
 * Simplified south polar stereographic projection for testing.
 *
 * Maps a rectangular tile in a planar CRS centered on the South Pole
 * to WGS84 (lon, lat). The projection is a true polar stereographic
 * with the origin at the South Pole (0, 0) in projected coordinates.
 *
 * Convention:
 * - x axis → 90°E direction
 * - y axis → 0° (prime meridian) direction
 * - South Pole is at (0, 0) in projected coords = (*, -90°) in WGS84
 */
function makePolarReprojectionFns(
  originX: number,
  originY: number,
  pixelSizeX: number,
  pixelSizeY: number,
): ReprojectionFns {
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
      // Polar stereographic → WGS84
      const rho = Math.sqrt(x * x + y * y);
      if (rho < 0.01) {
        // At the pole — longitude is undefined, return 0 by convention
        return [0, -90];
      }
      const c = 2 * Math.atan2(rho, 2 * R);
      const lat = ((c - Math.PI / 2) * 180) / Math.PI;
      const lon = (Math.atan2(x, y) * 180) / Math.PI;
      return [lon, lat];
    },
    inverseReproject(lon: number, lat: number): [number, number] {
      // WGS84 → polar stereographic
      const latRad = (lat * Math.PI) / 180;
      const lonRad = (lon * Math.PI) / 180;
      const rho = 2 * R * Math.tan(Math.PI / 4 + latRad / 2);
      const x = rho * Math.sin(lonRad);
      const y = rho * Math.cos(lonRad);
      return [x, y];
    },
  };
}

describe("polar projection support", () => {
  it("detects a tile containing the south pole", () => {
    // Tile centered on the south pole: spans ±500km around the pole
    // Origin is top-left corner in GeoTIFF convention
    const fns = makePolarReprojectionFns(-500000, 500000, 5000, -5000);
    const reprojector = new RasterReprojector(fns, 200, 200);

    expect(reprojector.crossesAntimeridian).toBe(true);
    expect(reprojector.containsPole).toBe(true);
  });

  it("does not flag a tile far from the pole", () => {
    // Tile at ~1500-2000km from pole (roughly -75° to -70° latitude)
    // At this distance, longitude spread is limited
    const fns = makePolarReprojectionFns(1500000, 2500000, 5000, -5000);
    const reprojector = new RasterReprojector(fns, 200, 200);

    expect(reprojector.containsPole).toBe(false);
  });

  it("generates a mesh for a polar tile with maxTriangles cap", () => {
    // Tile containing the south pole
    const fns = makePolarReprojectionFns(-500000, 500000, 5000, -5000);
    const reprojector = new RasterReprojector(fns, 200, 200);

    // Run with a safety cap — polar tiles may need many triangles
    reprojector.run(2.0, { maxTriangles: 5000 });

    const numTriangles = reprojector.triangles.length / 3;
    expect(numTriangles).toBeGreaterThan(2);
    // Each refine() step adds 2+ triangles atomically, so the final count
    // may slightly exceed the cap
    expect(numTriangles).toBeLessThanOrEqual(5010);

    // Verify mesh has vertices
    expect(reprojector.uvs.length).toBeGreaterThan(8); // more than initial 4 vertices
  });

  it("generates a valid mesh for a near-pole tile", () => {
    // Tile near the pole but not containing it
    // Offset so the pole is outside the tile extent
    const fns = makePolarReprojectionFns(200000, 700000, 5000, -5000);
    const reprojector = new RasterReprojector(fns, 200, 200);

    // Should still converge with a reasonable triangle count
    reprojector.run(2.0, { maxTriangles: 5000 });

    const numTriangles = reprojector.triangles.length / 3;
    expect(numTriangles).toBeGreaterThan(2);
  });

  it("mesh covers the expected latitude range", () => {
    // Tile containing the pole, spanning ~±4.5° from the pole
    const fns = makePolarReprojectionFns(-500000, 500000, 5000, -5000);
    const reprojector = new RasterReprojector(fns, 200, 200);
    reprojector.run(2.0, { maxTriangles: 5000 });

    // Check that output positions include latitudes near -90°
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (let i = 0; i < reprojector.exactOutputPositions.length; i += 2) {
      const lat = reprojector.exactOutputPositions[i + 1]!;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    // The tile should reach close to the pole (with capped triangle count,
    // the mesh may not have a vertex at exactly -90°)
    expect(minLat).toBeLessThan(-86);
    // And extend away from the pole
    expect(maxLat).toBeGreaterThan(-86);
  });

  it("maxTriangles stops refinement early", () => {
    const fns = makePolarReprojectionFns(-500000, 500000, 5000, -5000);
    const reprojector = new RasterReprojector(fns, 200, 200);

    // Use a very tight error threshold and low maxTriangles
    reprojector.run(0.01, { maxTriangles: 100 });

    const numTriangles = reprojector.triangles.length / 3;
    // Each refine() step adds 2+ triangles atomically, so the final count
    // may slightly exceed the cap
    expect(numTriangles).toBeLessThanOrEqual(110);
    // Error should still be above threshold since we stopped early
    expect(reprojector.getMaxError()).toBeGreaterThan(0.01);
  });

  it("round-trips through forward and inverse reprojection", () => {
    // Verify our test projection is self-consistent
    const fns = makePolarReprojectionFns(-500000, 500000, 5000, -5000);

    // Test a few points
    const testPoints: [number, number][] = [
      [100000, 200000],
      [-300000, 100000],
      [0, -400000],
    ];

    for (const [x, y] of testPoints) {
      const [lon, lat] = fns.forwardReproject(x, y);
      const [x2, y2] = fns.inverseReproject(lon, lat);
      expect(x2).toBeCloseTo(x, 0);
      expect(y2).toBeCloseTo(y, 0);
    }
  });
});
