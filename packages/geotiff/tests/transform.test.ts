import { describe, expect, it } from "vitest";
import type { Affine } from "../src/affine.js";
import { index, xy } from "../src/transform.js";

describe("index", () => {
  // Simple north-up, 1m resolution at (100, 200)
  const gt: Affine = [1, 0, 100, 0, -1, 200];

  it("returns [row, col] for a coordinate", () => {
    const [row, col] = index({ transform: gt }, 105, 195);
    expect(col).toBe(5);
    expect(row).toBe(5);
  });

  it("uses Math.floor by default", () => {
    const [row, col] = index({ transform: gt }, 100.9, 199.1);
    expect(col).toBe(0);
    expect(row).toBe(0);
  });

  it("accepts a custom rounding op", () => {
    const [row, col] = index({ transform: gt }, 100.9, 199.1, Math.round);
    expect(col).toBe(1);
    expect(row).toBe(1);
  });
});

describe("xy", () => {
  const gt: Affine = [1, 0, 100, 0, -1, 200];

  it("returns pixel center by default", () => {
    const [x, y] = xy({ transform: gt }, 0, 0);
    expect(x).toBeCloseTo(100.5);
    expect(y).toBeCloseTo(199.5);
  });

  it("returns upper-left corner", () => {
    const [x, y] = xy({ transform: gt }, 0, 0, "ul");
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(200);
  });

  it("returns lower-right corner", () => {
    const [x, y] = xy({ transform: gt }, 0, 0, "lr");
    expect(x).toBeCloseTo(101);
    expect(y).toBeCloseTo(199);
  });
});

describe("index/xy round-trip", () => {
  const gt: Affine = [0.5, 0, -180, 0, -0.5, 90];

  it("xy then index recovers the original pixel", () => {
    const row = 10;
    const col = 20;
    const [x, y] = xy({ transform: gt }, row, col, "ul");
    const [rRow, rCol] = index({ transform: gt }, x, y);
    expect(rRow).toBe(row);
    expect(rCol).toBe(col);
  });
});
