import { RangeReader } from "@developmentseed/range-reader";
import { describe, expect, it } from "vitest";
import { DEFAULT_RANGE_READER } from "../src/index.js";

describe("DEFAULT_RANGE_READER", () => {
  it("is a RangeReader exported from deck.gl-raster", () => {
    expect(DEFAULT_RANGE_READER).toBeInstanceOf(RangeReader);
  });
});
