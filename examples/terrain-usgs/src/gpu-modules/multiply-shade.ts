import type { ShaderModule } from "@luma.gl/shadertools";

/** Props for the {@link MultiplyShade} shader module. */
export type MultiplyShadeProps = {
  /**
   * How strongly the relief shading is mixed in, from `0` (untouched color)
   * to `1` (fully multiplied).
   */
  shadeStrength: number;
};

const MODULE_NAME = "multiplyShade";

/**
 * Multiplies the shading factor from {@link TerrainDerivative} into an
 * already-colormapped color, producing tinted relief: hypsometric color with
 * hillshaded texture.
 *
 * Pipeline contract:
 * - Reads: `float shade`, `vec4 color`
 * - Writes: `vec4 color`
 */
export const MultiplyShade = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  float shadeStrength;
} ${MODULE_NAME};
`,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
  color.rgb *= mix(1.0, shade, ${MODULE_NAME}.shadeStrength);
`,
  },
  uniformTypes: {
    shadeStrength: "f32",
  },
  getUniforms: (props: Partial<MultiplyShadeProps>) => {
    return {
      shadeStrength: props.shadeStrength ?? 1,
    };
  },
} as const satisfies ShaderModule<MultiplyShadeProps>;
