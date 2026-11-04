import { describe, expect, it } from "vitest";
import type { TileBorder } from "../src/terrain/halo.js";
import {
  buildHaloArray,
  buildRing,
  extractBorder,
  ringWrites,
} from "../src/terrain/halo.js";
import { CENTER_INDEX } from "../src/terrain/neighbors.js";

/** A 2 x 2 tile's border whose every sample is `value`. */
function constantBorder(value: number): TileBorder {
  const edge = () => Float32Array.from([value, value]);
  return { top: edge(), bottom: edge(), left: edge(), right: edge() };
}

/** Row `y` of a padded array `width` texels wide. */
function row(array: Float32Array, width: number, y: number): number[] {
  return Array.from(array.subarray(y * width, (y + 1) * width));
}

// A 2 x 2 center tile of distinct values, so a transposition shows:
//   1 2
//   3 4
const elevation = Float32Array.from([1, 2, 3, 4]);
const center = extractBorder(elevation, 2);

/** All eight neighbors, each a distinct constant, in neighborIndices order. */
function allNeighbors(): Array<TileBorder | null | undefined> {
  const borders: Array<TileBorder | null | undefined> = [
    constantBorder(10), // NW
    constantBorder(20), // N
    constantBorder(30), // NE
    constantBorder(40), // W
    undefined, // the center's slot, which buildRing ignores
    constantBorder(60), // E
    constantBorder(70), // SW
    constantBorder(80), // S
    constantBorder(90), // SE
  ];
  return borders;
}

describe("extractBorder", () => {
  it("takes the first and last rows and columns", () => {
    expect(
      extractBorder(Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), 3),
    ).toEqual({
      top: Float32Array.from([1, 2, 3]),
      bottom: Float32Array.from([7, 8, 9]),
      left: Float32Array.from([1, 4, 7]),
      right: Float32Array.from([3, 6, 9]),
    });
  });
});

describe("buildHaloArray", () => {
  it("returns a (tileSize + 2)^2 array", () => {
    const ring = buildRing({ center, neighbors: allNeighbors(), tileSize: 2 });
    expect(buildHaloArray({ elevation, ring, tileSize: 2 })).toHaveLength(16);
  });

  it("insets the tile by one texel", () => {
    const ring = buildRing({ center, neighbors: allNeighbors(), tileSize: 2 });
    const out = buildHaloArray({ elevation, ring, tileSize: 2 });
    expect(row(out, 4, 1).slice(1, 3)).toEqual([1, 2]);
    expect(row(out, 4, 2).slice(1, 3)).toEqual([3, 4]);
  });

  it("fills the ring from the eight neighbors, corners included", () => {
    const ring = buildRing({ center, neighbors: allNeighbors(), tileSize: 2 });
    const out = buildHaloArray({ elevation, ring, tileSize: 2 });
    expect(row(out, 4, 0)).toEqual([10, 20, 20, 30]);
    expect(row(out, 4, 1)).toEqual([40, 1, 2, 60]);
    expect(row(out, 4, 2)).toEqual([40, 3, 4, 60]);
    expect(row(out, 4, 3)).toEqual([70, 80, 80, 90]);
  });

  it("takes each ring texel from the nearest texel of its neighbor", () => {
    const border = (
      top: number[],
      bottom: number[],
      left: number[],
      right: number[],
    ) => ({
      top: Float32Array.from(top),
      bottom: Float32Array.from(bottom),
      left: Float32Array.from(left),
      right: Float32Array.from(right),
    });
    const neighbors = [
      border([0, 0], [11, 12], [0, 0], [0, 0]), // NW: its bottom-right is 12
      border([0, 0], [21, 22], [0, 0], [0, 0]), // N: its bottom row
      border([0, 0], [31, 32], [0, 0], [0, 0]), // NE: its bottom-left is 31
      border([0, 0], [0, 0], [0, 0], [41, 42]), // W: its right column
      undefined,
      border([0, 0], [0, 0], [61, 62], [0, 0]), // E: its left column
      border([71, 72], [0, 0], [0, 0], [0, 0]), // SW: its top-right is 72
      border([81, 82], [0, 0], [0, 0], [0, 0]), // S: its top row
      border([91, 92], [0, 0], [0, 0], [0, 0]), // SE: its top-left is 91
    ];
    const ring = buildRing({ center, neighbors, tileSize: 2 });
    const out = buildHaloArray({ elevation, ring, tileSize: 2 });
    expect(row(out, 4, 0)).toEqual([12, 21, 22, 31]);
    expect(row(out, 4, 1)).toEqual([41, 1, 2, 61]);
    expect(row(out, 4, 2)).toEqual([42, 3, 4, 62]);
    expect(row(out, 4, 3)).toEqual([72, 81, 82, 91]);
  });

  it("replicates the tile's own edge where a neighbor is absent", () => {
    const neighbors = allNeighbors();
    neighbors[3] = null; // no western neighbor
    neighbors[0] = undefined; // the north-western one hasn't arrived
    const ring = buildRing({ center, neighbors, tileSize: 2 });
    const out = buildHaloArray({ elevation, ring, tileSize: 2 });
    expect(row(out, 4, 0)[0]).toBe(1);
    expect(row(out, 4, 1)[0]).toBe(1);
    expect(row(out, 4, 2)[0]).toBe(3);
  });

  it("handles a corner tile with only three neighbors", () => {
    const neighbors: Array<TileBorder | null> = [
      null,
      null,
      null,
      null,
      null,
      constantBorder(60), // E
      null,
      constantBorder(80), // S
      constantBorder(90), // SE
    ];
    const ring = buildRing({ center, neighbors, tileSize: 2 });
    const out = buildHaloArray({ elevation, ring, tileSize: 2 });
    // NE and SW replicate the tile's corners even though E and S exist.
    expect(row(out, 4, 0)).toEqual([1, 1, 2, 2]);
    expect(row(out, 4, 3)).toEqual([3, 80, 80, 90]);
  });

  it("ignores whatever sits in the center's slot", () => {
    const neighbors = allNeighbors();
    neighbors[CENTER_INDEX] = constantBorder(-1);
    const ring = buildRing({ center, neighbors, tileSize: 2 });
    expect(
      Array.from(buildHaloArray({ elevation, ring, tileSize: 2 })),
    ).not.toContain(-1);
  });

  it("rejects an elevation of the wrong length", () => {
    const ring = buildRing({ center, neighbors: allNeighbors(), tileSize: 2 });
    expect(() =>
      buildHaloArray({
        elevation: Float32Array.from([1, 2, 3]),
        ring,
        tileSize: 2,
      }),
    ).toThrow(/expected 4/);
  });

  it("rejects a neighbor border of the wrong length", () => {
    const neighbors = allNeighbors();
    neighbors[5] = {
      ...constantBorder(60),
      left: Float32Array.from([1, 2, 3]),
    };
    expect(() => buildRing({ center, neighbors, tileSize: 2 })).toThrow(
      /expected 2/,
    );
  });
});

describe("ringWrites", () => {
  it("writes the four one-texel strips of the ring", () => {
    const ring = buildRing({ center, neighbors: allNeighbors(), tileSize: 2 });
    const writes = ringWrites(ring, 2);
    expect(
      writes.map(({ x, y, width, height }) => [x, y, width, height]),
    ).toEqual([
      [0, 0, 4, 1],
      [0, 3, 4, 1],
      [0, 1, 1, 2],
      [3, 1, 1, 2],
    ]);
    expect(writes.map(({ data }) => Array.from(data))).toEqual([
      [10, 20, 20, 30],
      [70, 80, 80, 90],
      [40, 40],
      [60, 60],
    ]);
  });
});
