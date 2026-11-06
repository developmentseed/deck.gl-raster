import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { describe, expect, it } from "vitest";
import { buildUniformGridMesh } from "../src/globe-grid-mesh.js";

// Identity reprojection: output position == pixel coordinate, so values are
// easy to assert.
const identityFns: ReprojectionFns = {
  forwardTransform: (x, y) => [x, y],
  inverseTransform: (x, y) => [x, y],
  forwardReproject: (x, y) => [x, y],
  inverseReproject: (x, y) => [x, y],
};

describe("buildUniformGridMesh", () => {
  it("produces an (n+1)^2 vertex grid with n*n*6 indices", () => {
    const n = 4;
    const { indices, positions64High, positions64Low, texCoords } =
      buildUniformGridMesh(identityFns, 257, 257, n);

    const numVerts = (n + 1) * (n + 1);
    expect(positions64High.length).toBe(numVerts * 3);
    expect(positions64Low.length).toBe(numVerts * 3);
    expect(texCoords.length).toBe(numVerts * 2);
    expect(indices.length).toBe(n * n * 6);
  });

  it("places texCoords on the unit grid and positions via the reprojection chain", () => {
    const n = 2;
    const { positions64High, texCoords } = buildUniformGridMesh(
      identityFns,
      81,
      81,
      n,
    );

    // First vertex: u=0, v=0 → pixel (0,0) → identity → (0,0).
    expect(texCoords[0]).toBeCloseTo(0);
    expect(texCoords[1]).toBeCloseTo(0);
    expect(positions64High[0]).toBeCloseTo(0);
    expect(positions64High[1]).toBeCloseTo(0);

    // Last vertex: u=1, v=1 → pixel (80,80) → identity → (80,80).
    const last = (n + 1) * (n + 1) - 1;
    expect(texCoords[last * 2]).toBeCloseTo(1);
    expect(texCoords[last * 2 + 1]).toBeCloseTo(1);
    expect(positions64High[last * 3]).toBeCloseTo(80);
    expect(positions64High[last * 3 + 1]).toBeCloseTo(80);
  });

  it("clamps latitudes past a pole to the pole", () => {
    // Rows of vertices at 100°, 0° and -100° latitude
    const fns: ReprojectionFns = {
      ...identityFns,
      forwardTransform: (x, y) => [x, 100 - 100 * y],
    };
    const { positions64High } = buildUniformGridMesh(fns, 3, 3, 2);

    const latitudes = Array.from(
      { length: 9 },
      (_, i) => positions64High[i * 3 + 1],
    );
    expect(latitudes).toEqual([90, 90, 90, 0, 0, 0, -90, -90, -90]);
  });
});
