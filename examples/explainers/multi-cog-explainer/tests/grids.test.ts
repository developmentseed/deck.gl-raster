import { describe, expect, it } from "vitest";
import { levelFor } from "../src/scene/geometry.js";
import { gridRings, tileRing } from "../src/scene/grids.js";

describe("gridRings", () => {
  it("outlines all 11 x 11 tiles of the 10 m grid", () => {
    expect(gridRings(levelFor("b04"))).toHaveLength(121);
  });

  it("ends the last column at the image edge, not the tile's", () => {
    const rings = gridRings(levelFor("b04"));
    const right = Math.max(...rings.flat().map(([x]) => x));
    expect(right).toBeCloseTo(709800, 6);
  });
});

describe("tileRing", () => {
  it("lets four 60 m tiles cover the 10 m story tile", () => {
    const b01 = levelFor("b01");
    const covering = [
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3],
    ].flatMap(([x, y]) => tileRing(b01, x!, y!));
    const xs = covering.map(([x]) => x);
    const ys = covering.map(([, y]) => y);
    const story = tileRing(levelFor("b04"), 4, 4);
    for (const [x, y] of story) {
      expect(x).toBeGreaterThanOrEqual(Math.min(...xs));
      expect(x).toBeLessThanOrEqual(Math.max(...xs));
      expect(y).toBeGreaterThanOrEqual(Math.min(...ys));
      expect(y).toBeLessThanOrEqual(Math.max(...ys));
    }
  });
});
