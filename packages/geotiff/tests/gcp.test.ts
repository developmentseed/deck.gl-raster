import { describe, expect, it } from "vitest";
import { parseGcps } from "../src/gcp.js";

describe("parseGcps", () => {
  it("returns null for missing tag", () => {
    expect(parseGcps(null)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(parseGcps([])).toBeNull();
  });

  it("returns null for a single tiepoint (affine variant marker)", () => {
    expect(parseGcps([0, 0, 0, 100, 200, 0])).toBeNull();
  });

  it("parses two tiepoints", () => {
    const gcps = parseGcps([0, 0, 0, 100, 200, 0, 10, 20, 0, 110, 220, 5]);
    expect(gcps).toEqual([
      { pixel: 0, line: 0, k: 0, x: 100, y: 200, z: 0 },
      { pixel: 10, line: 20, k: 0, x: 110, y: 220, z: 5 },
    ]);
  });

  it("throws on length not divisible by 6", () => {
    expect(() => parseGcps([0, 0, 0, 100, 200])).toThrow(/multiple of 6/);
  });
});
