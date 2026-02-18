import { describe, expect, it } from "vitest";
import { metersPerUnit } from "../src";

describe("metersPerUnit", () => {
  it("handles lowercase us survey foot", () => {
    expect(metersPerUnit("us survey foot")).toBe(1200 / 3937);
  });

  it("handles mixed case US Survey Foot", () => {
    // @ts-expect-error testing case insensitivity with non-standard casing
    expect(metersPerUnit("US Survey Foot")).toBe(1200 / 3937);
  });
});
