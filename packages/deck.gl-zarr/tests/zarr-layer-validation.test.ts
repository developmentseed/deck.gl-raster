import { describe, expect, it } from "vitest";
import { findSpatialDimIndices, validateSelection } from "../src/validation.js";

describe("validateSelection", () => {
  it("accepts a selection with all non-spatial dims specified", () => {
    expect(() =>
      validateSelection({
        dimensionNames: ["init_time", "lead_time", "ensemble_member", "y", "x"],
        spatialDims: ["y", "x"],
        selection: { init_time: 0, lead_time: null, ensemble_member: 0 },
      }),
    ).not.toThrow();
  });

  it("throws when a non-spatial dim is missing", () => {
    expect(() =>
      validateSelection({
        dimensionNames: ["init_time", "lead_time", "ensemble_member", "y", "x"],
        spatialDims: ["y", "x"],
        selection: { init_time: 0, ensemble_member: 0 }, // lead_time missing
      }),
    ).toThrow(/lead_time/);
  });

  it("throws when selection includes a spatial dim", () => {
    expect(() =>
      validateSelection({
        dimensionNames: ["init_time", "y", "x"],
        spatialDims: ["y", "x"],
        selection: { init_time: 0, y: 0 },
      }),
    ).toThrow(/spatial/);
  });

  it("throws when selection includes an unknown dim", () => {
    expect(() =>
      validateSelection({
        dimensionNames: ["init_time", "y", "x"],
        spatialDims: ["y", "x"],
        selection: { init_time: 0, bogus: 0 },
      }),
    ).toThrow(/bogus/);
  });
});

describe("findSpatialDimIndices", () => {
  it("finds spatial dims at the last two positions", () => {
    expect(
      findSpatialDimIndices({
        dimensionNames: ["init_time", "lead_time", "latitude", "longitude"],
        spatialDims: ["latitude", "longitude"],
      }),
    ).toEqual([2, 3]);
  });

  it("finds spatial dims before a trailing band dim", () => {
    expect(
      findSpatialDimIndices({
        dimensionNames: ["latitude", "longitude", "band"],
        spatialDims: ["latitude", "longitude"],
      }),
    ).toEqual([0, 1]);
  });

  it("finds spatial dims stored x before y", () => {
    expect(
      findSpatialDimIndices({
        dimensionNames: ["init_time", "longitude", "latitude"],
        spatialDims: ["latitude", "longitude"],
      }),
    ).toEqual([2, 1]);
  });

  it("throws when a declared spatial dim is missing from the array", () => {
    expect(() =>
      findSpatialDimIndices({
        dimensionNames: ["init_time", "lat", "lon"],
        spatialDims: ["latitude", "longitude"],
      }),
    ).toThrow(/latitude/);
  });
});
