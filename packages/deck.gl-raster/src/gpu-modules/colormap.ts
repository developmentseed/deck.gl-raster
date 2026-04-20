import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/** Props for the {@link Colormap} shader module. */
export type ColormapProps = {
  /**
   * The colormap sprite as a 2D array texture. Each layer of the array is
   * one 256×1 RGBA8 colormap. Build from the shipped `colormaps.png` with
   * `decodeColormapSprite` + `createColormapTexture`, or bring your own.
   */
  colormapTexture: Texture;
  /**
   * Which layer of `colormapTexture` to sample. Pass values from the
   * generated `COLORMAP_INDEX` for the shipped sprite, or any valid layer
   * index for a custom sprite. Defaults to `0`.
   */
  colormapIndex?: number;
  /**
   * When true, samples the colormap in reverse — equivalent to matplotlib's
   * `_r` suffix (e.g. `viridis_r`). Defaults to false.
   */
  reversed?: boolean;
};

const MODULE_NAME = "colormap";

/**
 * A shader module that injects a 2D-array colormap texture and samples one
 * layer per fragment, indexed by `colormapIndex`.
 */
export const Colormap = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  int colormapIndex;
  float reversed;
} ${MODULE_NAME};
`,
  inject: {
    "fs:#decl": `uniform sampler2DArray colormapTexture;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float idx = mix(color.r, 1.0 - color.r, ${MODULE_NAME}.reversed);
      color = texture(
        colormapTexture,
        vec3(idx, 0.5, float(${MODULE_NAME}.colormapIndex))
      );
    `,
  },
  uniformTypes: {
    colormapIndex: "i32",
    reversed: "f32",
  },
  getUniforms: (props: Partial<ColormapProps>) => {
    return {
      colormapTexture: props.colormapTexture,
      colormapIndex: props.colormapIndex ?? 0,
      reversed: props.reversed ?? false,
    };
  },
} as const satisfies ShaderModule<ColormapProps>;
