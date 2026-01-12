import type { ShaderModule } from "@luma.gl/shadertools";

const shader = /* glsl */ `
  vec3 black_zero_to_rgb(float value) {
    return vec3(value, value, value);
  }
`;

/**
 * A shader module that injects a unorm texture and uses a sampler2D to assign
 * to a color.
 */
export const BlackIsZero = {
  name: "black-is-zero",
  inject: {
    "fs:#decl": shader,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color.rgb = black_zero_to_rgb(color);
    `,
  },
} as const satisfies ShaderModule;
