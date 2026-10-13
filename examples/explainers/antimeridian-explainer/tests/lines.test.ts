import { describe, expect, it } from "vitest";
import {
  imageOutlineInPixels,
  imageOutlineInWebMercator,
  meridianInPixels,
  polylineBounds,
} from "../src/scene/lines.js";
import { UTM_HEIGHT, UTM_WIDTH, WORLD_WIDTH } from "../src/scene/utm60n.js";

describe("meridians", () => {
  it("draws 180° down the middle of the image, slightly slanted", () => {
    const line = meridianInPixels(180, [48, 56], 3);
    const [bottom, , top] = line;
    for (const [x] of line) {
      expect(x).toBeGreaterThan(19);
      expect(x).toBeLessThan(22);
    }
    expect(bottom![0] - top![0]).toBeGreaterThan(1);
  });
});

describe("image outline", () => {
  it("is a closed, densified ring in pixels", () => {
    const ring = imageOutlineInPixels(UTM_WIDTH, UTM_HEIGHT, 4);
    expect(ring.length).toBe(4 * 4 + 1);
    expect(ring[0]).toEqual([0, 0]);
    expect(ring[ring.length - 1]).toEqual([0, 0]);
    expect(ring[4]).toEqual([UTM_WIDTH, 0]);
  });

  it("is unwrapped into one piece that crosses +180°", () => {
    const [minX, , maxX] = polylineBounds(
      imageOutlineInWebMercator(UTM_WIDTH, UTM_HEIGHT, 16),
    );
    expect(maxX - minX).toBeLessThan(2e6);
    expect(minX).toBeLessThan(WORLD_WIDTH / 2);
    expect(maxX).toBeGreaterThan(WORLD_WIDTH / 2);
  });
});
