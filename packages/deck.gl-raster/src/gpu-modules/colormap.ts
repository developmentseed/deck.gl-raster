import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/** Props for the {@link Colormap} shader module. */
export type ColormapProps = {
  /** The 1D colormap texture to sample. */
  colormapTexture: Texture;
  /**
   * When true, samples the colormap in reverse — equivalent to matplotlib's
   * `_r` suffix (e.g. `viridis_r`). Defaults to false.
   */
  reversed?: boolean;
};

const MODULE_NAME = "colormap";

/**
 * A shader module that injects a unorm texture and uses a sampler2D to assign
 * to a color.
 */
export const Colormap = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  float reversed;
} ${MODULE_NAME};
`,
  inject: {
    "fs:#decl": `uniform sampler2D colormapTexture;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float idx = mix(color.r, 1.0 - color.r, ${MODULE_NAME}.reversed);
      color = texture(colormapTexture, vec2(idx, 0.));
    `,
  },
  uniformTypes: {
    reversed: "f32",
  },
  getUniforms: (props: Partial<ColormapProps>) => {
    return {
      colormapTexture: props.colormapTexture,
      reversed: props.reversed ?? false,
    };
  },
} as const satisfies ShaderModule<ColormapProps>;
