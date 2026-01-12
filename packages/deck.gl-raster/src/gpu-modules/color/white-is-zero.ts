import type { ShaderModule } from "@luma.gl/shadertools";

const shader = /* glsl */ `
  vec3 white_zero_to_rgb(float value) {
    return vec3(1.0 - value, 1.0 - value, 1.0 - value);
  }
`;

/**
 * A shader module that injects a unorm texture and uses a sampler2D to assign
 * to a color.
 */
export const WhiteIsZero = {
  name: "white-is-zero",
  inject: {
    "fs:#decl": shader,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color.rgb = white_zero_to_rgb(color);
    `,
  },
} as const satisfies ShaderModule;
