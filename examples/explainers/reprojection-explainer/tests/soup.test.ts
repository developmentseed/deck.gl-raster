import { describe, expect, it } from "vitest";
import {
  barycentricsFor,
  centroidsX,
  createSoup,
  expandByCorner,
  tintsFor,
} from "../src/animation/soup.js";

// Two triangles sharing the edge 1–2 of a unit square.
const TRIANGLES = [0, 1, 2, 2, 1, 3];
const POSITIONS = [0, 0, 10, 0, 0, 10, 10, 10];
const UVS = [0, 0, 1, 0, 0, 1, 1, 1];

describe("expandByCorner", () => {
  it("copies each vertex's values to every corner that uses it", () => {
    expect(Array.from(expandByCorner(TRIANGLES, POSITIONS, 2))).toEqual([
      0, 0, 10, 0, 0, 10, 0, 10, 10, 0, 10, 10,
    ]);
  });
});

describe("barycentricsFor", () => {
  it("gives each triangle's corners (1,0,0), (0,1,0), (0,0,1)", () => {
    expect(Array.from(barycentricsFor(1))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(barycentricsFor(2).length).toBe(18);
  });
});

describe("tintsFor", () => {
  it("is transparent without a tint function", () => {
    expect(tintsFor(2).every((v) => v === 0)).toBe(true);
  });

  it("tints all three corners of the chosen triangles", () => {
    const tints = tintsFor(2, (t) => (t === 1 ? [1, 0.5, 0, 0.4] : null));
    expect(Array.from(tints.subarray(0, 12)).every((v) => v === 0)).toBe(true);
    expect(Array.from(tints.subarray(12, 16))).toEqual(
      [1, 0.5, 0, 0.4].map(Math.fround),
    );
    expect(Array.from(tints.subarray(20, 24))).toEqual(
      [1, 0.5, 0, 0.4].map(Math.fround),
    );
  });
});

describe("createSoup", () => {
  it("de-indexes positions and UVs together", () => {
    const soup = createSoup({
      triangles: TRIANGLES,
      positions: POSITIONS,
      uvs: UVS,
    });
    expect(soup.vertexCount).toBe(6);
    expect(soup.positions.length).toBe(12);
    expect(soup.texCoords.length).toBe(12);
    expect(soup.barycentrics.length).toBe(18);
    expect(soup.tints.length).toBe(24);
    expect(Array.from(soup.texCoords.subarray(6, 8))).toEqual([0, 1]);
  });
});

describe("centroidsX", () => {
  it("averages the three corners' x of each triangle", () => {
    const corners = expandByCorner(TRIANGLES, POSITIONS, 2);
    expect(Array.from(centroidsX(corners))).toEqual([
      Math.fround(10 / 3),
      Math.fround(20 / 3),
    ]);
  });
});
