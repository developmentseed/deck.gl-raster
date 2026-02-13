import { describe, expect, it } from "vitest";
import type { Affine } from "../src/affine.js";
import { forward, invert } from "../src/affine.js";

describe("forward", () => {
  it("applies an identity-like transform", () => {
    const gt: Affine = [1, 0, 0, 0, 1, 0];
    expect(forward(gt, 3, 4)).toEqual([3, 4]);
  });

  it("applies translation", () => {
    const gt: Affine = [1, 0, 10, 0, 1, 20];
    expect(forward(gt, 5, 5)).toEqual([15, 25]);
  });

  it("applies scale + translation", () => {
    const gt: Affine = [0.5, 0, 100, 0, -0.5, 200];
    expect(forward(gt, 10, 20)).toEqual([105, 190]);
  });
});

describe("invert", () => {
  it("inverts a simple scale+translate transform", () => {
    const gt: Affine = [2, 0, 10, 0, -3, 50];
    const inv = invert(gt);
    // Applying the inverse should undo the forward transform
    const [x, y] = forward(gt, 5, 7);
    const [col, row] = forward(inv, x, y);
    expect(col).toBeCloseTo(5);
    expect(row).toBeCloseTo(7);
  });

  it("throws for a degenerate transform", () => {
    const gt: Affine = [0, 0, 0, 0, 0, 0];
    expect(() => invert(gt)).toThrow(/degenerate/);
  });
});
