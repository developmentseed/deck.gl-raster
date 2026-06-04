import { describe, expect, it } from "vitest";
import { createInitialWebMercatorTriangulation } from "../../src/raster-tileset/web-mercator-clamp.js";

const MAX_LAT = 85.05112877980659;

describe("createInitialWebMercatorTriangulation", () => {
  it("returns undefined for a tile within Web Mercator bounds", () => {
    expect(
      createInitialWebMercatorTriangulation({
        topLeft: 40,
        topRight: 40,
        bottomLeft: 30,
        bottomRight: 30,
      }),
    ).toBeUndefined();
  });

  it("clamps a global north-up tile to the valid band on both edges", () => {
    const seed = createInitialWebMercatorTriangulation({
      topLeft: 90,
      topRight: 90,
      bottomLeft: -90,
      bottomRight: -90,
    });
    expect(seed).toBeDefined();
    // triangulateRectangle(0, vTop, 1, vBottom) → uvs = [0,vTop, 1,vTop, 0,vBottom, 1,vBottom]
    expect(seed?.uvs[1]).toBeCloseTo((90 - MAX_LAT) / 180, 9); // vTop
    expect(seed?.uvs[5]).toBeCloseTo((90 + MAX_LAT) / 180, 9); // vBottom
    expect(seed?.uvs[0]).toBe(0);
    expect(seed?.uvs[2]).toBe(1);
  });

  it("clamps only the north edge when only the north exceeds the bound", () => {
    const seed = createInitialWebMercatorTriangulation({
      topLeft: 90,
      topRight: 90,
      bottomLeft: 80,
      bottomRight: 80,
    });
    expect(seed?.uvs[1]).toBeCloseTo((90 - MAX_LAT) / 10, 9); // vTop in (0,1)
    expect(seed?.uvs[5]).toBe(1); // south within bounds → vBottom clamped to 1
  });

  it("clamps a global south-up tile (row 0 = south pole) to the valid band", () => {
    // A positive-`e` affine (GRIB/IFS-derived grids) makes the top row the
    // south pole, so topLeft is the southern edge. Previously this tripped the
    // `north - south <= 0` guard and skipped the clamp, leaving the pole to be
    // meshed (degenerate near-pole triangles → "did not converge"). See #574.
    const seed = createInitialWebMercatorTriangulation({
      topLeft: -90,
      topRight: -90,
      bottomLeft: 90,
      bottomRight: 90,
    });
    expect(seed).toBeDefined();
    // v=0 is the south pole here; the band starts where lat reaches -MAX_LAT.
    expect(seed?.uvs[1]).toBeCloseTo((90 - MAX_LAT) / 180, 9); // vTop
    expect(seed?.uvs[5]).toBeCloseTo((90 + MAX_LAT) / 180, 9); // vBottom
    expect(seed?.uvs[0]).toBe(0);
    expect(seed?.uvs[2]).toBe(1);
  });

  it("clamps only the south edge of a south-up tile", () => {
    // top (row 0) = south pole exceeding the bound; bottom (north) within it.
    const seed = createInitialWebMercatorTriangulation({
      topLeft: -90,
      topRight: -90,
      bottomLeft: 80,
      bottomRight: 80,
    });
    expect(seed?.uvs[1]).toBeCloseTo((90 - MAX_LAT) / 170, 9); // vTop in (0,1)
    expect(seed?.uvs[5]).toBe(1); // north within bounds → vBottom clamped to 1
  });

  it("returns undefined for a non-north-up (rotated) tile", () => {
    expect(
      createInitialWebMercatorTriangulation({
        topLeft: 90,
        topRight: 88,
        bottomLeft: -90,
        bottomRight: -88,
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a fully-polar tile (empty band)", () => {
    expect(
      createInitialWebMercatorTriangulation({
        topLeft: 88,
        topRight: 88,
        bottomLeft: 86,
        bottomRight: 86,
      }),
    ).toBeUndefined();
  });
});
