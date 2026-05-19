import { describe, expect, it } from "vitest";
import { assertFp64Invariants } from "../../src/mesh-layer/assert-fp64-invariants.js";

const VALID_PROPS = {
  _instanced: false,
  sizeScale: 1,
  getPosition: [0, 0, 0],
  getOrientation: undefined,
  getTransformMatrix: undefined,
  getTranslation: undefined,
  getScale: undefined,
};

describe("assertFp64Invariants", () => {
  it("does not throw with RasterLayer's expected usage", () => {
    expect(() => assertFp64Invariants(VALID_PROPS as never)).not.toThrow();
  });

  it("throws when _instanced is not false", () => {
    expect(() =>
      assertFp64Invariants({ ...VALID_PROPS, _instanced: true } as never),
    ).toThrow(/_instanced/);
  });

  it("throws when sizeScale is not 1", () => {
    expect(() =>
      assertFp64Invariants({ ...VALID_PROPS, sizeScale: 2 } as never),
    ).toThrow(/sizeScale/);
  });

  it("throws when getPosition is not [0,0,0]", () => {
    expect(() =>
      assertFp64Invariants({
        ...VALID_PROPS,
        getPosition: [1, 0, 0],
      } as never),
    ).toThrow(/getPosition/);
  });

  it("throws when getPosition is a function (accessor) — only constants allowed", () => {
    expect(() =>
      assertFp64Invariants({
        ...VALID_PROPS,
        getPosition: () => [0, 0, 0],
      } as never),
    ).toThrow(/getPosition/);
  });

  it("throws when getOrientation is set", () => {
    expect(() =>
      assertFp64Invariants({
        ...VALID_PROPS,
        getOrientation: [0, 0, 1],
      } as never),
    ).toThrow(/getOrientation/);
  });

  it("throws when getTransformMatrix is set", () => {
    expect(() =>
      assertFp64Invariants({
        ...VALID_PROPS,
        getTransformMatrix: new Array(16).fill(0),
      } as never),
    ).toThrow(/getTransformMatrix/);
  });
});
