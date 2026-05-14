import type { ShaderModule } from "@luma.gl/shadertools";

const shader = /* glsl */ `
  vec3 white_zero_to_rgb(float value) {
    return vec3(1.0 - value, 1.0 - value, 1.0 - value);
  }
`;

/**
 * A shader module that converts single-band grayscale data to RGB by
 * broadcasting the inverted input value (0 = white, 1 = black) into all
 * three channels. Matches TIFF `PhotometricInterpretation = 0` (WhiteIsZero).
 */
export const WhiteIsZero = {
  name: "white-is-zero",
  inject: {
    "fs:#decl": shader,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color.rgb = white_zero_to_rgb(color.r);
    `,
  },
} as const satisfies ShaderModule;
