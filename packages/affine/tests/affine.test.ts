import { describe, expect, it } from "vitest";
import type { Affine } from "../src/affine.js";
import {
  apply,
  compose,
  identity,
  invert,
  rotation,
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

describe("rotation", () => {
  it("rotates 90° CCW about the origin", () => {
    const r = rotation(90);
    const [x, y] = apply(r, 1, 0);
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(1, 10);
  });

  it("returns exact 0/±1 entries for right-angle rotations", () => {
    // Math.cos(Math.PI / 2) is ~6e-17, not 0; cosSinDeg short-circuits these
    // multiples of 90° so the resulting matrix has exact zeros. Slots derived
    // from `-sa` carry `-0` when `sa === 0`, matching upstream Python `affine`.
    expect(rotation(90)).toEqual([0, -1, 0, 1, 0, 0]);
    expect(rotation(180)).toEqual([-1, -0, 0, 0, -1, 0]);
    expect(rotation(270)).toEqual([0, 1, 0, -1, 0, 0]);
    expect(rotation(360)).toEqual([1, -0, 0, 0, 1, 0]);
    expect(rotation(-90)).toEqual([0, 1, 0, -1, 0, 0]);
  });

  it("rotates 180° about the origin", () => {
    const r = rotation(180);
    const [x, y] = apply(r, 3, 4);
    expect(x).toBeCloseTo(-3, 10);
    expect(y).toBeCloseTo(-4, 10);
  });

  it("identity at 0°", () => {
    const r = rotation(0);
    const [x, y] = apply(r, 7, 11);
    expect(x).toBeCloseTo(7, 10);
    expect(y).toBeCloseTo(11, 10);
  });

  it("rotates about a non-origin pivot", () => {
    // 90° CCW about (5, 5): point (5, 6) should go to (4, 5).
    const r = rotation(90, [5, 5]);
    const [x, y] = apply(r, 5, 6);
    expect(x).toBeCloseTo(4, 10);
    expect(y).toBeCloseTo(5, 10);
  });

  it("leaves the pivot point fixed", () => {
    const pivot: [number, number] = [3, 7];
    const r = rotation(45, pivot);
    const [x, y] = apply(r, ...pivot);
    expect(x).toBeCloseTo(pivot[0], 10);
    expect(y).toBeCloseTo(pivot[1], 10);
  });
});
