import { describe, expect, it } from "vitest";
import type { Affine } from "../src/affine.js";
import {
  apply,
  compose,
  identity,
  invert,
  scale,
  translation,
} from "../src/affine.js";

describe("apply", () => {
  it("applies an identity-like transform", () => {
    const gt: Affine = [1, 0, 0, 0, 1, 0];
    expect(apply(gt, 3, 4)).toEqual([3, 4]);
  });

  it("applies translation", () => {
    const gt: Affine = [1, 0, 10, 0, 1, 20];
    expect(apply(gt, 5, 5)).toEqual([15, 25]);
  });

  it("applies scale + translation", () => {
    const gt: Affine = [0.5, 0, 100, 0, -0.5, 200];
    expect(apply(gt, 10, 20)).toEqual([105, 190]);
  });
});

describe("invert", () => {
  it("inverts a simple scale+translate transform", () => {
    const gt: Affine = [2, 0, 10, 0, -3, 50];
    const inv = invert(gt);
    const [x, y] = apply(gt, 5, 7);
    const [col, row] = apply(inv, x, y);
    expect(col).toBeCloseTo(5);
    expect(row).toBeCloseTo(7);
  });

  it("throws for a degenerate transform", () => {
    const gt: Affine = [0, 0, 0, 0, 0, 0];
    expect(() => invert(gt)).toThrow(/degenerate/);
  });
});

describe("compose", () => {
  it("compose with identity is a no-op", () => {
    const t = translation(10, 20);
    expect(compose(t, identity())).toEqual(t);
    expect(compose(identity(), t)).toEqual(t);
  });

  it("translation × scale: translates the scaled point", () => {
    // T × S means: scale first, then translate
    const t = translation(100, 200);
    const s = scale(2, 3);
    const ts = compose(t, s);
    // (5,10) → scale → (10,30) → translate → (110,230)
    expect(apply(ts, 5, 10)).toEqual([110, 230]);
  });

  it("scale × translation: scales the already-translated point", () => {
    // S × T means: translate first, then scale
    const t = translation(100, 200);
    const s = scale(2, 3);
    const st = compose(s, t);
    // (5,10) → translate → (105,210) → scale → (210,630)
    expect(apply(st, 5, 10)).toEqual([210, 630]);
  });

  it("is not commutative", () => {
    const t = translation(10, 20);
    const s = scale(2, 3);
    expect(compose(t, s)).not.toEqual(compose(s, t));
  });
});
