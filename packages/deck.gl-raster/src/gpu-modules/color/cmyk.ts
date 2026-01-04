import type { ShaderModule } from "@luma.gl/shadertools";

const shader = /* glsl */ `
  vec3 cmykToRgb(vec4 cmyk) {
    // cmyk in [0.0, 1.0]
    float invK = 1.0 - cmyk.a;

    return vec3(
        (1.0 - cmyk.r) * invK,
        (1.0 - cmyk.g) * invK,
        (1.0 - cmyk.b) * invK
    );
  }
`;

/**
 * A shader module that injects a unorm texture and uses a sampler2D to assign
 * to a color.
 */
export const CMYKToRGB = {
  name: "cmyk-to-rgb",
  inject: {
    "fs:#decl": shader,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color.rgb = cmykToRgb(color);
    `,
  },
} as const satisfies ShaderModule<{}>;
