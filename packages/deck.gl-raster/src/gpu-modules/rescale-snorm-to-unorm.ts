import type { ShaderModule } from "@luma.gl/shadertools";

const shader = /* glsl */ `
  vec4 rescaleSnormToUnorm(vec4 value) {
    return (value + 1.0) / 2.0;
  }
`;

/**
 * A shader module that injects a unorm texture and uses a sampler2D to assign
 * to a color.
 */
export const RescaleSnormToUnorm = {
  name: "rescale-snorm-to-unorm",
  inject: {
    "fs:#decl": shader,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = rescaleSnormToUnorm(color);
    `,
  },
} as const satisfies ShaderModule;
