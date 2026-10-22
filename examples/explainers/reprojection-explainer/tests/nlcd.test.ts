import { describe, expect, it } from "vitest";
import {
  albersToLngLat,
  albersToPixel,
  albersToWebMercator,
  lngLatToAlbers,
  lngLatToWebMercator,
  NLCD_HEIGHT,
  NLCD_WIDTH,
  pixelToAlbers,
  webMercatorToAlbers,
} from "../src/scene/nlcd.js";

describe("NLCD georeferencing", () => {
  it("maps the image corners to their known longitude and latitude", () => {
    const ul = albersToLngLat(...pixelToAlbers(0, 0));
    const ur = albersToLngLat(...pixelToAlbers(NLCD_WIDTH, 0));
    const ll = albersToLngLat(...pixelToAlbers(0, NLCD_HEIGHT));
    expect(ul[0]).toBeCloseTo(-129.2773, 3);
    expect(ul[1]).toBeCloseTo(48.9935, 3);
    expect(ur[0]).toBeCloseTo(-63.1184, 3);
    expect(ur[1]).toBeCloseTo(49.0903, 3);
    expect(ll[0]).toBeCloseTo(-119.0479, 3);
    expect(ll[1]).toBeCloseTo(21.8051, 3);
  });

  it("round-trips pixel → Albers → pixel", () => {
    const [x, y] = albersToPixel(...pixelToAlbers(1234.5, 567.25));
    expect(x).toBeCloseTo(1234.5, 6);
    expect(y).toBeCloseTo(567.25, 6);
  });

  it("round-trips Albers → Web Mercator → Albers", () => {
    const [x, y] = webMercatorToAlbers(...albersToWebMercator(100000, 2000000));
    expect(x).toBeCloseTo(100000, 3);
    expect(y).toBeCloseTo(2000000, 3);
  });

  it("puts 49°N at row ≈222 on the central meridian", () => {
    const [col, row] = albersToPixel(...lngLatToAlbers(-96, 49));
    expect(col).toBeCloseTo(1258.1, 0);
    expect(row).toBeCloseTo(222.2, 0);
  });

  it("projects 49°N to y = 6,274,861 m in Web Mercator", () => {
    expect(lngLatToWebMercator(-100, 49)[1]).toBeCloseTo(6274861.39, 1);
  });
});
