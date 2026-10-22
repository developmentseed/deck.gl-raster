import { clipMeshToWorld } from "@developmentseed/deck.gl-raster/internal/clip-mesh-to-world.js";
import { rescaleEPSG3857ToCommonSpace } from "@developmentseed/deck.gl-raster/internal/raster-tileset/raster-tile-traversal.js";
import { describe, expect, it } from "vitest";

describe("the private alias", () => {
  it("reaches clipMeshToWorld through the private alias", () => {
    const clipped = clipMeshToWorld(
      {
        // Crosses x 0 with no vertex on it: a triangle west, a quad east.
        positions: [-2, 0, 2, 0, 1, 2],
        uvs: [0, 0, 1, 0, 0, 1],
        triangles: [0, 1, 2],
      },
      512,
    );
    expect(clipped.triangles.length / 3).toBe(3);
    const xs = clipped.positions.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(512);
  });

  it("reaches the common-space rescale", () => {
    expect(rescaleEPSG3857ToCommonSpace([0, 0])).toEqual([256, 256]);
  });
});
