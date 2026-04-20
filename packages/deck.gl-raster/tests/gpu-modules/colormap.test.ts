import type { Texture } from "@luma.gl/core";
import { describe, expect, it } from "vitest";
import { Colormap } from "../../src/gpu-modules/colormap.js";

describe("Colormap", () => {
  it("declares the colormapTexture sampler2DArray in fs:#decl", () => {
    expect(Colormap.inject["fs:#decl"]).toContain(
      "uniform sampler2DArray colormapTexture;",
    );
  });

  it("declares colormapIndex and reversed in the uniform block", () => {
    expect(Colormap.fs).toContain("int colormapIndex;");
    expect(Colormap.fs).toContain("float reversed;");
  });

  it("samples the 2D array texture with a vec3(idx, 0.5, layer) coordinate", () => {
    const filter = Colormap.inject["fs:DECKGL_FILTER_COLOR"];
    expect(filter).toContain("mix(color.r, 1.0 - color.r, colormap.reversed)");
    expect(filter).toContain("texture(");
    expect(filter).toContain("colormapTexture");
    expect(filter).toContain("float(colormap.colormapIndex)");
    expect(filter).toContain("0.5");
  });

  it("declares colormapIndex as i32 and reversed as f32 in uniformTypes", () => {
    expect(Colormap.uniformTypes.colormapIndex).toBe("i32");
    expect(Colormap.uniformTypes.reversed).toBe("f32");
  });

  describe("getUniforms", () => {
    const mockTexture = { id: "cmap" } as unknown as Texture;

    it("passes colormapTexture through", () => {
      const uniforms = Colormap.getUniforms({ colormapTexture: mockTexture });
      expect(uniforms.colormapTexture).toBe(mockTexture);
    });

    it("passes colormapIndex through", () => {
      const uniforms = Colormap.getUniforms({
        colormapTexture: mockTexture,
        colormapIndex: 5,
      });
      expect(uniforms.colormapIndex).toBe(5);
    });

    it("defaults colormapIndex to 0 when omitted", () => {
      const uniforms = Colormap.getUniforms({ colormapTexture: mockTexture });
      expect(uniforms.colormapIndex).toBe(0);
    });

    it("passes reversed=true through", () => {
      const uniforms = Colormap.getUniforms({
        colormapTexture: mockTexture,
        reversed: true,
      });
      expect(uniforms.reversed).toBe(true);
    });

    it("defaults reversed to false when omitted", () => {
      const uniforms = Colormap.getUniforms({ colormapTexture: mockTexture });
      expect(uniforms.reversed).toBe(false);
    });
  });
});
