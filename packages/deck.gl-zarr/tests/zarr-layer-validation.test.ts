import { describe, expect, it } from "vitest";
import {
  validateSelection,
  validateSpatialDimOrder,
} from "../src/validation.js";

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

describe("validateSpatialDimOrder", () => {
  it("accepts spatial dims at the last two positions in y,x order", () => {
    expect(() =>
      validateSpatialDimOrder({
        dimensionNames: ["init_time", "lead_time", "latitude", "longitude"],
        spatialDims: ["latitude", "longitude"],
      }),
    ).not.toThrow();
  });

  it("throws when spatial dims are not last", () => {
    expect(() =>
      validateSpatialDimOrder({
        dimensionNames: ["latitude", "longitude", "band"],
        spatialDims: ["latitude", "longitude"],
      }),
    ).toThrow(/last two/);
  });

  it("throws when y and x are swapped", () => {
    expect(() =>
      validateSpatialDimOrder({
        dimensionNames: ["init_time", "longitude", "latitude"],
        spatialDims: ["latitude", "longitude"],
      }),
    ).toThrow(/order/);
  });

  it("throws when a declared spatial dim is missing from the array", () => {
    expect(() =>
      validateSpatialDimOrder({
        dimensionNames: ["init_time", "lat", "lon"],
        spatialDims: ["latitude", "longitude"],
      }),
    ).toThrow(/latitude/);
  });
});
