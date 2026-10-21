import { describe, expect, it } from "vitest";
import type { BandId } from "../src/scene/constants.js";
import {
  insetRect,
  levelFor,
  resolveStoryTile,
} from "../src/scene/geometry.js";

const levels = {
  b04: levelFor("b04"),
  b11: levelFor("b11"),
  b01: levelFor("b01"),
} satisfies Record<BandId, unknown>;

describe("resolveStoryTile", () => {
  const tile = resolveStoryTile(levels);

  it("covers tile (4, 4) with one 20 m tile, as its top-left quarter", () => {
    const b11 = tile.bands.b11;
    expect(b11.tiles).toEqual([{ x: 2, y: 2 }]);
    expect([b11.stitchedWidth, b11.stitchedHeight]).toEqual([1024, 1024]);
    const [offsetX, offsetY, scaleX, scaleY] = b11.uvTransform;
    expect(offsetX).toBeCloseTo(0, 9);
    expect(offsetY).toBeCloseTo(0, 9);
    expect(scaleX).toBeCloseTo(0.5, 9);
    expect(scaleY).toBeCloseTo(0.5, 9);
  });

  it("covers tile (4, 4) with four 60 m tiles, as their middle ninth", () => {
    const b01 = tile.bands.b01;
    expect(b01.tiles).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
    expect([b01.stitchedWidth, b01.stitchedHeight]).toEqual([512, 512]);
    for (const value of b01.uvTransform) {
      expect(value).toBeCloseTo(1 / 3, 9);
    }
  });

  it("places tile (4, 4) at UTM x 640960-651200, y 4348820-4359060", () => {
    const { topLeft, bottomRight } = tile.primaryCorners;
    expect(topLeft[0]).toBeCloseTo(640960, 6);
    expect(topLeft[1]).toBeCloseTo(4359060, 6);
    expect(bottomRight[0]).toBeCloseTo(651200, 6);
    expect(bottomRight[1]).toBeCloseTo(4348820, 6);
  });

  it("keeps the 10 m tile whole: its own texture, with no transform", () => {
    expect(tile.bands.b04).toEqual({
      tiles: [{ x: 4, y: 4 }],
      stitchedWidth: 1024,
      stitchedHeight: 1024,
      uvTransform: [0, 0, 1, 1],
      minCol: 4,
      minRow: 4,
    });
  });
});

describe("insetRect", () => {
  const tile = resolveStoryTile(levels);

  it("centres a 600 m square on the story tile in each band's texture", () => {
    expect(insetRect("b04", tile)).toEqual({
      x: 482,
      y: 482,
      width: 60,
      height: 60,
    });
    expect(insetRect("b11", tile)).toEqual({
      x: 241,
      y: 241,
      width: 30,
      height: 30,
    });
    expect(insetRect("b01", tile)).toEqual({
      x: 251,
      y: 251,
      width: 10,
      height: 10,
    });
  });
});
