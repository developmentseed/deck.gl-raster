import type { ShaderModule } from "@luma.gl/shadertools";

const shader = /* glsl */ `
  vec3 black_zero_to_rgb(float value) {
    return vec3(value, value, value);
  }
`;

/**
 * A shader module that converts single-band grayscale data to RGB by
 * broadcasting the input value (0 = black, 1 = white) into all three
 * channels. Matches TIFF `PhotometricInterpretation = 1` (BlackIsZero).
 */
export const BlackIsZero = {
  name: "black-is-zero",
  inject: {
    "fs:#decl": shader,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color.rgb = black_zero_to_rgb(color.r);
    `,
  },
} as const satisfies ShaderModule;
