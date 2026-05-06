import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/** Props for the {@link PaletteColormap} shader module. */
export type PaletteColormapProps = {
  /**
   * 256×1 `rgba8unorm` colormap texture indexed by integer category code.
   * Alpha=0 entries (e.g. for nodata) render as transparent.
   */
  colormapTexture: Texture;
};

/**
 * Resolves the integer category code (read from `icolor.r`) into a final
 * RGBA color via integer-indexed lookup into a 256×1 colormap texture.
 * Discards the fragment when the colormap entry is fully transparent
 * (alpha=0), which `parseColormap` produces for the nodata index.
 *
 * Pipeline contract:
 * - Reads: `ivec4 icolor` (introduced by an upstream module such as
 *   `CreateTextureUint`)
 * - Writes: `vec4 color` (the framework output bus)
 *
 * Replaces the default `Colormap` module for the integer-aware land-cover
 * pipeline. Uses `texelFetch` instead of normalized `texture()` sampling
 * so the sampler filter cannot blend neighbouring categories.
 */
export const PaletteColormap = {
  name: "palette-colormap",
  inject: {
    "fs:#decl": `uniform sampler2D colormapTexture;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = texelFetch(colormapTexture, ivec2(icolor.r, 0), 0);
      if (color.a == 0.0) {
        discard;
      }
    `,
  },
  getUniforms: (props: Partial<PaletteColormapProps>) => {
    return {
      colormapTexture: props.colormapTexture,
    };
  },
} as const satisfies ShaderModule<PaletteColormapProps>;
