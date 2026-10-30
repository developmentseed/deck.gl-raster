import { describe, expect, it } from "vitest";
import {
  CENTER_INDEX,
  neighborIndices,
  tileKey,
} from "../src/terrain/neighbors.js";

describe("neighborIndices", () => {
  it("lists the 3 x 3 block row-major from the top-left, the tile at CENTER_INDEX", () => {
    const tiles = neighborIndices({ z: 2, x: 1, y: 1 });
    expect(tiles).toEqual([
      { z: 2, x: 0, y: 0 },
      { z: 2, x: 1, y: 0 },
      { z: 2, x: 2, y: 0 },
      { z: 2, x: 0, y: 1 },
      { z: 2, x: 1, y: 1 },
      { z: 2, x: 2, y: 1 },
      { z: 2, x: 0, y: 2 },
      { z: 2, x: 1, y: 2 },
      { z: 2, x: 2, y: 2 },
    ]);
    expect(tiles[CENTER_INDEX]).toEqual({ z: 2, x: 1, y: 1 });
  });

  it("wraps west across the antimeridian", () => {
    const tiles = neighborIndices({ z: 2, x: 0, y: 1 });
    expect(tiles[0]).toEqual({ z: 2, x: 3, y: 0 });
    expect(tiles[3]).toEqual({ z: 2, x: 3, y: 1 });
    expect(tiles[6]).toEqual({ z: 2, x: 3, y: 2 });
  });

  it("wraps east across the antimeridian", () => {
    expect(neighborIndices({ z: 2, x: 3, y: 1 })[5]).toEqual({
      z: 2,
      x: 0,
      y: 1,
    });
  });

  it("has no row above the top row", () => {
    expect(neighborIndices({ z: 2, x: 3, y: 0 }).slice(0, 3)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("has no row below the bottom row", () => {
    expect(neighborIndices({ z: 2, x: 1, y: 3 }).slice(6, 9)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("makes the lone z0 tile its own east and west neighbor", () => {
    const self = { z: 0, x: 0, y: 0 };
    expect(neighborIndices(self)).toEqual([
      null,
      null,
      null,
      self,
      self,
      self,
      null,
      null,
      null,
    ]);
  });
});

describe("tileKey", () => {
  it("joins z, x and y with slashes", () => {
    expect(tileKey({ z: 12, x: 2135, y: 1457 })).toBe("12/2135/1457");
  });
});
