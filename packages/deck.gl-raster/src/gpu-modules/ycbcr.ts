import type { ShaderModule } from "@luma.gl/shadertools";

const shader = /* glsl */ `
  vec3 ycbcrToRgb(vec3 ycbcr) {
    // ycbcr in [0.0, 1.0]
    float y = ycbcr.r;
    float cb = ycbcr.g - 0.5;
    float cr = ycbcr.b - 0.5;

    return vec3(
        y + 1.40200 * cr,
        y - 0.34414 * cb - 0.71414 * cr,
        y + 1.77200 * cb
    );
  }
`;

/**
 * A shader module that injects a unorm texture and uses a sampler2D to assign
 * to a color.
 */
export const YCbCrToRGB = {
  name: "ycbcr-to-rgb",
  inject: {
    "fs:#decl": shader,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color.rgb = ycbcrToRgb(color.rgb);
    `,
  },
  getUniforms: () => {
    return {};
  },
} as const satisfies ShaderModule<{}>;
