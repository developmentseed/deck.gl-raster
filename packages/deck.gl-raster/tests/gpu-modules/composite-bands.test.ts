import { describe, expect, it } from "vitest";
import { createCompositeBandsModule } from "../../src/gpu-modules/composite-bands.js";

describe("createCompositeBandsModule", () => {
  it("creates a shader module with correct uniforms for RGB bands", () => {
    const mod = createCompositeBandsModule({ r: "red", g: "green", b: "blue" });
    expect(mod.name).toBe("composite-bands");
    const decl = mod.inject["fs:#decl"];
    expect(decl).toContain("uniform sampler2D band_red;");
    expect(decl).toContain("uniform sampler2D band_green;");
    expect(decl).toContain("uniform sampler2D band_blue;");
    expect(decl).toContain("uniform vec4 uvTransform_red;");
    expect(decl).toContain("uniform vec4 uvTransform_green;");
    expect(decl).toContain("uniform vec4 uvTransform_blue;");
    const filterColor = mod.inject["fs:DECKGL_FILTER_COLOR"];
    expect(filterColor).toContain("band_red");
    expect(filterColor).toContain("band_green");
    expect(filterColor).toContain("band_blue");
    expect(filterColor).toContain("uvTransform_red");
  });

  it("creates a module with only 2 bands (r and g, no blue)", () => {
    const mod = createCompositeBandsModule({ r: "nir", g: "swir" });
    const decl = mod.inject["fs:#decl"];
    expect(decl).toContain("uniform sampler2D band_nir;");
    expect(decl).toContain("uniform sampler2D band_swir;");
    const filterColor = mod.inject["fs:DECKGL_FILTER_COLOR"];
    expect(filterColor).toContain("0.0"); // default for missing blue
  });

  it("supports an alpha channel", () => {
    const mod = createCompositeBandsModule({
      r: "red",
      g: "green",
      b: "blue",
      a: "alpha",
    });
    const decl = mod.inject["fs:#decl"];
    expect(decl).toContain("uniform sampler2D band_alpha;");
    expect(decl).toContain("uniform vec4 uvTransform_alpha;");
  });

  it("getUniforms passes through texture and transform props", () => {
    const mod = createCompositeBandsModule({ r: "red", g: "green", b: "blue" });
    const mockTexture = { id: "tex" };
    const uniforms = mod.getUniforms({
      band_red: mockTexture,
      uvTransform_red: [0, 0, 1, 1],
    });
    expect(uniforms.band_red).toBe(mockTexture);
    expect(uniforms.uvTransform_red).toEqual([0, 0, 1, 1]);
  });
});
