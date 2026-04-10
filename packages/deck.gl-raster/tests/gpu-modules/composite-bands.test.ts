import type { Texture } from "@luma.gl/core";
import { describe, expect, it } from "vitest";
import {
  buildCompositeBandsProps,
  CompositeBands,
} from "../../src/gpu-modules/composite-bands.js";

describe("CompositeBands", () => {
  it("has static uniform declarations for 4 band slots", () => {
    // Texture samplers are in inject["fs:#decl"]
    const decl = CompositeBands.inject["fs:#decl"];
    expect(decl).toContain("uniform sampler2D band0;");
    expect(decl).toContain("uniform sampler2D band1;");
    expect(decl).toContain("uniform sampler2D band2;");
    expect(decl).toContain("uniform sampler2D band3;");

    // Scalar uniforms are in fs (uniform block)
    const fsBlock = CompositeBands.fs;
    expect(fsBlock).toContain("uvTransform0");
    expect(fsBlock).toContain("uvTransform1");
    expect(fsBlock).toContain("channelMap");
  });

  it("has uniformTypes for vec4 transforms and ivec4 channelMap", () => {
    expect(CompositeBands.uniformTypes.uvTransform0).toBe("vec4<f32>");
    expect(CompositeBands.uniformTypes.channelMap).toBe("vec4<i32>");
  });

  it("getUniforms provides defaults", () => {
    const uniforms = CompositeBands.getUniforms({});
    expect(uniforms.uvTransform0).toEqual([0, 0, 1, 1]);
    expect(uniforms.channelMap).toEqual([0, 1, 2, -1]);
  });
});

describe("buildCompositeBandsProps", () => {
  const mockTexture = (id: string) => ({ id }) as unknown as Texture;
  const identityUv = [0, 0, 1, 1] as const;

  it("maps RGB bands to slots 0, 1, 2", () => {
    const bands = new Map([
      ["red", { texture: mockTexture("r"), uvTransform: identityUv }],
      ["green", { texture: mockTexture("g"), uvTransform: identityUv }],
      ["blue", { texture: mockTexture("b"), uvTransform: identityUv }],
    ]);

    const props = buildCompositeBandsProps(
      { r: "red", g: "green", b: "blue" },
      bands,
    );

    expect(props.band0).toBe(bands.get("red")!.texture);
    expect(props.band1).toBe(bands.get("green")!.texture);
    expect(props.band2).toBe(bands.get("blue")!.texture);
    expect(props.channelMap).toEqual([0, 1, 2, -1]);
  });

  it("deduplicates bands used in multiple channels", () => {
    const bands = new Map([
      ["gray", { texture: mockTexture("g"), uvTransform: identityUv }],
    ]);

    const props = buildCompositeBandsProps(
      { r: "gray", g: "gray", b: "gray" },
      bands,
    );

    expect(props.band0).toBe(bands.get("gray")!.texture);
    // Unused slots are filled with the first texture as a placeholder
    expect(props.band1).toBe(bands.get("gray")!.texture);
    expect(props.band2).toBe(bands.get("gray")!.texture);
    expect(props.band3).toBe(bands.get("gray")!.texture);
    expect(props.channelMap).toEqual([0, 0, 0, -1]);
  });

  it("passes UV transforms to correct slots", () => {
    const customUv = [0.1, 0.2, 0.5, 0.5] as const;
    const bands = new Map([
      ["nir", { texture: mockTexture("nir"), uvTransform: customUv }],
      ["red", { texture: mockTexture("red"), uvTransform: identityUv }],
    ]);

    const props = buildCompositeBandsProps({ r: "nir", g: "red" }, bands);

    expect(props.uvTransform0).toEqual([0.1, 0.2, 0.5, 0.5]);
    expect(props.uvTransform1).toEqual([0, 0, 1, 1]);
  });

  it("sets alpha channel to -1 when not provided", () => {
    const bands = new Map([
      ["r", { texture: mockTexture("r"), uvTransform: identityUv }],
    ]);

    const props = buildCompositeBandsProps({ r: "r" }, bands);
    expect(props.channelMap![3]).toBe(-1);
  });

  it("throws when band is not found in the map", () => {
    const bands = new Map([
      ["red", { texture: mockTexture("r"), uvTransform: identityUv }],
    ]);

    expect(() =>
      buildCompositeBandsProps({ r: "red", g: "missing" }, bands),
    ).toThrow('Band "missing" not found');
  });
});
