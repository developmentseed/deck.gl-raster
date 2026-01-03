import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

// Props expected by the Colormap shader module
export type ColormapProps = {
  colormapTexture: Texture;
};

/**
 * A shader module that injects a unorm texture and uses a sampler2D to assign
 * to a color.
 */
export const Colormap = {
  name: "colormap",
  inject: {
    "fs:#decl": `uniform sampler2D colormapTexture;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = texture(colormapTexture, vec2(color.r, 0.));
    `,
  },
  getUniforms: (props: Partial<ColormapProps>) => {
    return {
      colormapTexture: props.colormapTexture,
    };
  },
} as const satisfies ShaderModule<ColormapProps>;
