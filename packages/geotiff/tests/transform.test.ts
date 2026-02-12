import { describe, expect, it } from "vitest";
import type { Affine } from "../src/affine.js";
import {
  applyGeoTransform,
  index,
  invertGeoTransform,
  xy,
} from "../src/transform.js";

describe("applyGeoTransform", () => {
  it("applies an identity-like transform", () => {
    const gt: Affine = [1, 0, 0, 0, 1, 0];
    expect(applyGeoTransform(3, 4, gt)).toEqual([3, 4]);
  });

  it("applies translation", () => {
    const gt: Affine = [1, 0, 10, 0, 1, 20];
    expect(applyGeoTransform(5, 5, gt)).toEqual([15, 25]);
  });

  it("applies scale + translation", () => {
    const gt: Affine = [0.5, 0, 100, 0, -0.5, 200];
    expect(applyGeoTransform(10, 20, gt)).toEqual([105, 190]);
  });
});

describe("invertGeoTransform", () => {
  it("inverts a simple scale+translate transform", () => {
    const gt: Affine = [2, 0, 10, 0, -3, 50];
    const inv = invertGeoTransform(gt);
    // Applying the inverse should undo the forward transform
    const [x, y] = applyGeoTransform(5, 7, gt);
    const [col, row] = applyGeoTransform(x, y, inv);
    expect(col).toBeCloseTo(5);
    expect(row).toBeCloseTo(7);
  });

  it("throws for a degenerate transform", () => {
    const gt: Affine = [0, 0, 0, 0, 0, 0];
    expect(() => invertGeoTransform(gt)).toThrow(/degenerate/);
  });
});

describe("index", () => {
  // Simple north-up, 1m resolution at (100, 200)
  const gt: Affine = [1, 0, 100, 0, -1, 200];

  it("returns [row, col] for a coordinate", () => {
    const [row, col] = index(gt, 105, 195);
    expect(col).toBe(5);
    expect(row).toBe(5);
  });

  it("uses Math.floor by default", () => {
    const [row, col] = index(gt, 100.9, 199.1);
    expect(col).toBe(0);
    expect(row).toBe(0);
  });

  it("accepts a custom rounding op", () => {
    const [row, col] = index(gt, 100.9, 199.1, Math.round);
    expect(col).toBe(1);
    expect(row).toBe(1);
  });
});

describe("xy", () => {
  const gt: Affine = [1, 0, 100, 0, -1, 200];

  it("returns pixel center by default", () => {
    const [x, y] = xy(gt, 0, 0);
    expect(x).toBeCloseTo(100.5);
    expect(y).toBeCloseTo(199.5);
  });

  it("returns upper-left corner", () => {
    const [x, y] = xy(gt, 0, 0, "ul");
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(200);
  });

  it("returns lower-right corner", () => {
    const [x, y] = xy(gt, 0, 0, "lr");
    expect(x).toBeCloseTo(101);
    expect(y).toBeCloseTo(199);
  });
});

describe("index/xy round-trip", () => {
  const gt: Affine = [0.5, 0, -180, 0, -0.5, 90];

  it("xy then index recovers the original pixel", () => {
    const row = 10;
    const col = 20;
    const [x, y] = xy(gt, row, col, "ul");
    const [rRow, rCol] = index(gt, x, y);
    expect(rRow).toBe(row);
    expect(rCol).toBe(col);
  });
});
