import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import {
  makeClampedForwardTo3857,
  wrapAntimeridianProjections,
} from "../src/proj.js";

const WGS84_ELLIPSOID_A = 6378137;
const EPSG_3857_HALF_CIRCUMFERENCE = Math.PI * WGS84_ELLIPSOID_A;

describe("makeClampedForwardTo3857", () => {
  const converter3857 = proj4("EPSG:4326", "EPSG:3857");
  const converter4326 = proj4("EPSG:4326", "EPSG:4326");

  const forwardTo3857 = (x: number, y: number): [number, number] =>
    converter3857.forward([x, y], false);
  const forwardTo4326 = (x: number, y: number): [number, number] =>
    converter4326.forward([x, y], false);

  const clampedForward = makeClampedForwardTo3857(forwardTo3857, forwardTo4326);

  it("passes through a normal mid-latitude point unchanged", () => {
    const [x, y] = clampedForward(0, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it("clamps north pole (lat=90) to finite 3857 Y", () => {
    const [x, y] = clampedForward(0, 90);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeCloseTo(EPSG_3857_HALF_CIRCUMFERENCE, 0);
  });

  it("clamps south pole (lat=-90) to finite negative 3857 Y", () => {
    const [x, y] = clampedForward(0, -90);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeCloseTo(-EPSG_3857_HALF_CIRCUMFERENCE, 0);
  });

  it("clamps north pole at non-zero longitude", () => {
    const [x, y] = clampedForward(180, 90);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    expect(x).toBeCloseTo(EPSG_3857_HALF_CIRCUMFERENCE, 0);
    expect(y).toBeCloseTo(EPSG_3857_HALF_CIRCUMFERENCE, 0);
  });
});

describe("wrapAntimeridianProjections", () => {
  const converter3857 = proj4("EPSG:4326", "EPSG:3857");

  const forwardTo3857 = (x: number, y: number): [number, number] =>
    converter3857.forward([x, y], false);
  const inverseFrom3857 = (x: number, y: number): [number, number] =>
    converter3857.inverse([x, y], false);

  it("returns original functions when tile does not cross antimeridian", () => {
    // Tile from lon 10° to 20° — well within one hemisphere
    const cornerXs = [10, 20].map((lon) => forwardTo3857(lon, 0)[0]);
    const result = wrapAntimeridianProjections(
      cornerXs,
      forwardTo3857,
      inverseFrom3857,
    );
    expect(result.forwardTo3857).toBe(forwardTo3857);
    expect(result.inverseFrom3857).toBe(inverseFrom3857);
  });

  it("wraps functions when tile crosses the antimeridian", () => {
    // Tile corners at lon +170° and -170° (crosses ±180°)
    const cornerXs = [170, -170].map((lon) => forwardTo3857(lon, 0)[0]);
    const result = wrapAntimeridianProjections(
      cornerXs,
      forwardTo3857,
      inverseFrom3857,
    );
    // Should return new (wrapped) functions
    expect(result.forwardTo3857).not.toBe(forwardTo3857);
    expect(result.inverseFrom3857).not.toBe(inverseFrom3857);
  });

  it("produces continuous x-values for antimeridian-crossing tiles", () => {
    const cornerXs = [170, -170].map((lon) => forwardTo3857(lon, 0)[0]);
    const { forwardTo3857: wrapped } = wrapAntimeridianProjections(
      cornerXs,
      forwardTo3857,
      inverseFrom3857,
    );

    const x170 = wrapped(170, 0)[0];
    const xNeg170 = wrapped(-170, 0)[0];

    // Both should now be positive and close together (~20° apart in meters)
    expect(x170).toBeGreaterThan(0);
    expect(xNeg170).toBeGreaterThan(0);
    expect(Math.abs(xNeg170 - x170)).toBeLessThan(5_000_000);
  });

  it("round-trips through wrapped forward and inverse", () => {
    const cornerXs = [170, -170].map((lon) => forwardTo3857(lon, 0)[0]);
    const result = wrapAntimeridianProjections(
      cornerXs,
      forwardTo3857,
      inverseFrom3857,
    );

    // Forward then inverse should recover the original lon/lat
    const [mx, my] = result.forwardTo3857(-175, 45);
    const [lon, lat] = result.inverseFrom3857(mx, my);
    expect(lon).toBeCloseTo(-175, 4);
    expect(lat).toBeCloseTo(45, 4);
  });
});
