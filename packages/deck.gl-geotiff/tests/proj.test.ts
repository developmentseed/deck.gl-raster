import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { makeClampedForwardTo3857 } from "../src/proj.js";

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
