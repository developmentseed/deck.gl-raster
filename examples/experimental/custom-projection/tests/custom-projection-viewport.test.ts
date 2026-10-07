import { WebMercatorViewport } from "@deck.gl/core";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import {
  CustomProjectionViewport,
  NORMALIZATION_SCALE,
  pixelToWorld,
} from "../src/custom-projection/index.js";

const ARCTIC =
  "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
const WEB_MERCATOR = "EPSG:3857";

function arcticViewport(
  options: Partial<
    ConstructorParameters<typeof CustomProjectionViewport>[0]
  > = {},
) {
  return new CustomProjectionViewport({
    projection: proj4("EPSG:4326", ARCTIC),
    fromCrs: "EPSG:4326",
    toCrs: ARCTIC,
    fromBounds: [-180, 0, 180, 90],
    width: 800,
    height: 600,
    center: [-45, 75, 0],
    zoom: 3,
    ...options,
  });
}

describe("CustomProjectionViewport", () => {
  it("places the camera at the projected center", () => {
    const viewport = arcticViewport();
    const [x, y] = proj4("EPSG:4326", ARCTIC).forward([-45, 75]);
    expect(viewport.target[0]).toBeCloseTo(x!, 6);
    expect(viewport.target[1]).toBeCloseTo(y!, 6);
    // The projected center lands in the middle of the screen.
    const pixel = viewport.project([x!, y!]);
    expect(pixel[0]).toBeCloseTo(400, 6);
    expect(pixel[1]).toBeCloseTo(300, 6);
  });

  it("prefers target over center", () => {
    const viewport = arcticViewport({ target: [1000, 2000, 0] });
    expect(viewport.target).toEqual([1000, 2000, 0]);
  });

  it("uses upstream's map-meter → common scale, so zoom matches MapView", () => {
    const viewport = arcticViewport({ zoom: 5 });
    expect(viewport.projectFlat([1, 2])).toEqual([
      NORMALIZATION_SCALE,
      2 * NORMALIZATION_SCALE,
    ]);
    // 2^zoom CSS pixels per common unit, like WebMercatorViewport.
    expect(viewport.scale).toBe(32);
    expect(viewport.metersPerPixel).toBeCloseTo(1 / (32 * NORMALIZATION_SCALE));
  });

  it("matches WebMercatorViewport pixels for a Web Mercator converter", () => {
    const zoom = 4;
    const custom = new CustomProjectionViewport({
      projection: proj4("EPSG:4326", WEB_MERCATOR),
      toCrs: WEB_MERCATOR,
      width: 800,
      height: 600,
      center: [10, 50, 0],
      zoom,
    });
    const mercator = new WebMercatorViewport({
      width: 800,
      height: 600,
      longitude: 10,
      latitude: 50,
      zoom,
    });
    for (const lngLat of [
      [10, 50],
      [12.5, 51],
      [7, 48.2],
    ]) {
      const expected = mercator.project(lngLat);
      const actual = custom.project(custom.preproject(lngLat).slice(0, 2));
      expect(actual[0]).toBeCloseTo(expected[0]!, 3);
      expect(actual[1]).toBeCloseTo(expected[1]!, 3);
    }
  });

  it("round-trips through preproject and postUnproject", () => {
    const viewport = arcticViewport();
    const world = viewport.postUnproject(viewport.preproject([20, 70, 0]));
    expect(world?.[0]).toBeCloseTo(20, 9);
    expect(world?.[1]).toBeCloseTo(70, 9);
  });

  it("clamps positions to fromBounds before projecting", () => {
    const viewport = arcticViewport();
    expect(viewport.preproject([20, -40, 0])).toEqual(
      viewport.preproject([20, 0, 0]),
    );
  });

  it("falls back to the origin for an unprojectable center", () => {
    const viewport = new CustomProjectionViewport({
      projection: {
        forward: () => [Number.NaN, Number.NaN],
        inverse: () => null,
      },
      width: 100,
      height: 100,
      center: [0, 0, 0],
    });
    expect(viewport.target).toEqual([0, 0, 0]);
  });

  it("converts pixels to world coordinates", () => {
    const viewport = arcticViewport();
    const world = pixelToWorld(viewport, [400, 300]);
    expect(world?.[0]).toBeCloseTo(-45, 6);
    expect(world?.[1]).toBeCloseTo(75, 6);
  });

  it("treats viewports with different projections as unequal", () => {
    const a = arcticViewport();
    const b = arcticViewport();
    const c = arcticViewport({ toCrs: `${ARCTIC} +wktext` });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it("prefers zoomX over a stale zoom while the controller applies an anchor", () => {
    const viewport = arcticViewport({ zoom: 2, zoomX: 4, zoomY: 4 });
    expect(viewport.zoom).toBe(4);
    expect(viewport.scale).toBe(16);
  });
});
