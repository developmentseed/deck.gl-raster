import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * A shader module that draws every pixel opaque by setting alpha to 1.
 *
 * For images whose fourth band isn't alpha, such as NAIP's near-infrared band,
 * which a four-channel texture would otherwise draw as alpha.
 */
export const Opaque = {
  name: "opaque",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color.a = 1.0;
    `,
  },
} as const satisfies ShaderModule;

/**
 * A shader module that takes alpha from the second band of a gray+alpha image.
 *
 * A two-channel texture samples the second band into `color.g`. Put this module
 * before {@link BlackIsZero} or {@link WhiteIsZero}, which overwrite `color.g`.
 */
export const GrayAlpha = {
  name: "gray-alpha",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color.a = color.g;
    `,
  },
} as const satisfies ShaderModule;
