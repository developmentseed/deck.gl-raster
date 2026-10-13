import { describe, expect, it } from "vitest";
import {
  lngLatToUtm,
  pixelToUtm,
  UTM_HEIGHT,
  UTM_WIDTH,
  utmToLngLat,
  utmToPixel,
  utmToWebMercator,
  WORLD_WIDTH,
  webMercatorToUtm,
} from "../src/scene/utm60n.js";

describe("UTM 60N georeferencing", () => {
  it("puts the image's west corners east of 180°, and its east corners west", () => {
    const ul = utmToLngLat(...pixelToUtm(0, 0));
    const ur = utmToLngLat(...pixelToUtm(UTM_WIDTH, 0));
    expect(ul[0]).toBeCloseTo(173.8, 1);
    expect(ul[1]).toBeCloseTo(55.9, 1);
    expect(ur[0]).toBeCloseTo(-172.84, 1);
  });

  it("round-trips pixel → UTM → pixel", () => {
    const [x, y] = utmToPixel(...pixelToUtm(12.5, 30.25));
    expect(x).toBeCloseTo(12.5, 9);
    expect(y).toBeCloseTo(30.25, 9);
  });

  it("wraps x on the way to Web Mercator", () => {
    const west = utmToWebMercator(...pixelToUtm(0, 0))[0];
    const east = utmToWebMercator(...pixelToUtm(UTM_WIDTH, 0))[0];
    expect(west).toBeGreaterThan(WORLD_WIDTH / 2 - 1e6);
    expect(east).toBeLessThan(-WORLD_WIDTH / 2 + 1e6);
  });

  it("maps any world copy of x back to the same UTM point", () => {
    const utm = pixelToUtm(UTM_WIDTH, 0);
    const [x, y] = utmToWebMercator(...utm);
    for (const copy of [-1, 1, 2]) {
      const back = webMercatorToUtm(x + copy * WORLD_WIDTH, y);
      expect(back[0]).toBeCloseTo(utm[0], 3);
      expect(back[1]).toBeCloseTo(utm[1], 3);
    }
  });

  it("runs the 180° meridian through the image", () => {
    const [col] = utmToPixel(...lngLatToUtm(180, 52));
    expect(col).toBeGreaterThan(0);
    expect(col).toBeLessThan(UTM_WIDTH);
  });

  it("is 42 px square", () => {
    expect([UTM_WIDTH, UTM_HEIGHT]).toEqual([42, 42]);
  });
});
