import { describe, expect, it } from "vitest";
import { assertFp64Invariants } from "../../src/mesh-layer/assert-fp64-invariants.js";

// Matches what deck.gl resolves at runtime: getOrientation/getScale/
// getTranslation default to identity vec3s, getTransformMatrix defaults to
// an empty array, sizeScale defaults to 1.
const VALID_PROPS = {
  _instanced: false,
  sizeScale: 1,
  getPosition: [0, 0, 0],
  getOrientation: [0, 0, 0],
  getScale: [1, 1, 1],
  getTranslation: [0, 0, 0],
  getTransformMatrix: [],
};

describe("assertFp64Invariants", () => {
  it("does not throw with RasterLayer's expected usage (deck.gl identity defaults)", () => {
    expect(() => assertFp64Invariants(VALID_PROPS as never)).not.toThrow();
  });

  it("does not throw when accessor props are omitted entirely (let deck.gl fill defaults)", () => {
    expect(() =>
      assertFp64Invariants({
        _instanced: false,
        sizeScale: 1,
        getPosition: [0, 0, 0],
      } as never),
    ).not.toThrow();
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

  it("throws when getPosition is a function accessor", () => {
    expect(() =>
      assertFp64Invariants({
        ...VALID_PROPS,
        getPosition: () => [0, 0, 0],
      } as never),
    ).toThrow(/getPosition/);
  });

  it("throws when getOrientation is a non-identity constant", () => {
    expect(() =>
      assertFp64Invariants({
        ...VALID_PROPS,
        getOrientation: [0, 0, 1],
      } as never),
    ).toThrow(/getOrientation/);
  });

  it("throws when getOrientation is a function accessor", () => {
    expect(() =>
      assertFp64Invariants({
        ...VALID_PROPS,
        getOrientation: () => [0, 0, 0],
      } as never),
    ).toThrow(/getOrientation/);
  });

  it("throws when getScale is a non-identity constant", () => {
    expect(() =>
      assertFp64Invariants({
        ...VALID_PROPS,
        getScale: [2, 1, 1],
      } as never),
    ).toThrow(/getScale/);
  });

  it("throws when getTranslation is a non-identity constant", () => {
    expect(() =>
      assertFp64Invariants({
        ...VALID_PROPS,
        getTranslation: [1, 0, 0],
      } as never),
    ).toThrow(/getTranslation/);
  });

  it("throws when getTransformMatrix is non-empty", () => {
    expect(() =>
      assertFp64Invariants({
        ...VALID_PROPS,
        getTransformMatrix: new Array(16).fill(0),
      } as never),
    ).toThrow(/getTransformMatrix/);
  });

  it("throws when getTransformMatrix is a function accessor", () => {
    expect(() =>
      assertFp64Invariants({
        ...VALID_PROPS,
        getTransformMatrix: () => [],
      } as never),
    ).toThrow(/getTransformMatrix/);
  });
});
