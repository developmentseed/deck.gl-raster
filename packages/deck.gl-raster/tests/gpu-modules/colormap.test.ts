import type { Texture } from "@luma.gl/core";
import { describe, expect, it } from "vitest";
import { Colormap } from "../../src/gpu-modules/colormap.js";

describe("Colormap", () => {
  it("declares the colormapTexture sampler in fs:#decl", () => {
    expect(Colormap.inject["fs:#decl"]).toContain(
      "uniform sampler2D colormapTexture;",
    );
  });

  it("declares a `reversed` float in the uniform block", () => {
    expect(Colormap.fs).toContain("float reversed;");
  });

  it("reverses the sample index via mix() when reversed is 1.0", () => {
    const filter = Colormap.inject["fs:DECKGL_FILTER_COLOR"];
    expect(filter).toContain("mix(color.r, 1.0 - color.r, colormap.reversed)");
    expect(filter).toContain("texture(colormapTexture");
  });

  it("declares `reversed` as f32 in uniformTypes", () => {
    expect(Colormap.uniformTypes.reversed).toBe("f32");
  });

  describe("getUniforms", () => {
    const mockTexture = { id: "cmap" } as unknown as Texture;

    it("passes colormapTexture through", () => {
      const uniforms = Colormap.getUniforms({ colormapTexture: mockTexture });
      expect(uniforms.colormapTexture).toBe(mockTexture);
    });

    it("passes reversed=true through", () => {
      const uniforms = Colormap.getUniforms({
        colormapTexture: mockTexture,
        reversed: true,
      });
      expect(uniforms.reversed).toBe(true);
    });

    it("passes reversed=false through", () => {
      const uniforms = Colormap.getUniforms({
        colormapTexture: mockTexture,
        reversed: false,
      });
      expect(uniforms.reversed).toBe(false);
    });

    it("defaults reversed to false when omitted", () => {
      const uniforms = Colormap.getUniforms({ colormapTexture: mockTexture });
      expect(uniforms.reversed).toBe(false);
    });
  });
});
