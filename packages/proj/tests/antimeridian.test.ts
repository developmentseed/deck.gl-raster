import { describe, expect, it } from "vitest";
import {
  normalizeLongitudes,
  splitAtAntimeridian,
  unwrapBbox,
} from "../src/index.js";

describe("normalizeLongitudes", () => {
  it("moves bounds east of 180° back one world, keeping their width", () => {
    expect(normalizeLongitudes([183, -10, 191, 10])).toEqual([
      -177, -10, -169, 10,
    ]);
  });

  it("moves the west edge into [-180, 180), so the east edge can run past 180°", () => {
    expect(normalizeLongitudes([-185, -10, -175, 10])).toEqual([
      175, -10, 185, 10,
    ]);
  });

  it("leaves bounds whose west edge is in [-180, 180) alone", () => {
    expect(normalizeLongitudes([170, -10, 190, 10])).toEqual([
      170, -10, 190, 10,
    ]);
  });

  it("gives the whole world for bounds 360° or wider", () => {
    expect(normalizeLongitudes([-400, -10, 400, 10])).toEqual([
      -180, -10, 180, 10,
    ]);
  });
});

describe("splitAtAntimeridian", () => {
  it("splits bounds that run past 180° into a box on each side", () => {
    expect(splitAtAntimeridian([175, -10, 185, 10])).toEqual([
      [175, -10, 180, 10],
      [-180, -10, -175, 10],
    ]);
  });

  it("keeps bounds that end at 180° whole", () => {
    expect(splitAtAntimeridian([175, -10, 180, 10])).toEqual([
      [175, -10, 180, 10],
    ]);
  });

  it("keeps bounds within [-180, 180] whole", () => {
    expect(splitAtAntimeridian([10, -10, 20, 10])).toEqual([[10, -10, 20, 10]]);
  });
});

describe("unwrapBbox", () => {
  it("moves the east edge of a bbox across the antimeridian one world east", () => {
    // Written with minX > maxX, as GeoJSON and STAC do.
    expect(unwrapBbox([179, -20, -179, -17])).toEqual([179, -20, 181, -17]);
  });

  it("leaves any other bbox alone", () => {
    expect(unwrapBbox([10, -10, 20, 10])).toEqual([10, -10, 20, 10]);
  });
});
