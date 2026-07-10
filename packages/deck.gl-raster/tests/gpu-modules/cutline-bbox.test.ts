import { describe, expect, it } from "vitest";
import { CutlineBbox } from "../../src/gpu-modules/cutline-bbox.js";

describe("CutlineBbox", () => {
  it("has the expected module name", () => {
    expect(CutlineBbox.name).toBe("cutlineBbox");
  });

  it("declares a vec4<f32> bbox uniform", () => {
    expect(CutlineBbox.uniformTypes.bbox).toBe("vec4<f32>");
  });

  it("declares the uniform block in fs", () => {
    expect(CutlineBbox.fs).toContain("cutlineBboxUniforms");
    expect(CutlineBbox.fs).toContain("vec4 bbox");
  });

  it("injects a common-space varying write in the vertex shader", () => {
    const vsMainStart = CutlineBbox.inject["vs:#main-start"];
    expect(vsMainStart).toContain("v_cutlineBboxCommon");
    expect(vsMainStart).toContain("positions.xy");
    expect(CutlineBbox.inject["vs:#decl"]).toContain(
      "out vec2 v_cutlineBboxCommon",
    );
    expect(CutlineBbox.inject["fs:#decl"]).toContain(
      "in vec2 v_cutlineBboxCommon",
    );
  });

  it("injects a discard into fs:#main-start", () => {
    const injected = CutlineBbox.inject["fs:#main-start"];
    expect(injected).toContain("v_cutlineBboxCommon");
    expect(injected).toContain("discard");
  });

  it("getUniforms passes the common-space bbox through unchanged (no per-frame projection)", () => {
    const bbox: [number, number, number, number] = [80, 300, 90, 310];
    const uniforms = CutlineBbox.getUniforms({ bbox });
    expect(uniforms.bbox).toBe(bbox);
  });

  it("getUniforms returns an empty object when bbox is not provided", () => {
    expect(CutlineBbox.getUniforms({})).toEqual({});
  });
});
