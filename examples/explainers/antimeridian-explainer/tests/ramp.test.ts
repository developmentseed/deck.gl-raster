import { describe, expect, it } from "vitest";
import { rampColor } from "../src/scene/ramp.js";

describe("rampColor", () => {
  it("colors the first column dark purple and the last yellow", () => {
    expect(rampColor(1)).toEqual([68, 1, 84, 255]);
    expect(rampColor(42)).toEqual([253, 231, 37, 255]);
  });

  it("blends between the ramp's stops", () => {
    expect(rampColor(6)).toEqual([64, 42, 112, 255]);
  });

  it("leaves nodata transparent", () => {
    expect(rampColor(0)).toEqual([0, 0, 0, 0]);
  });
});
