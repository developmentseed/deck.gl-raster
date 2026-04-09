import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Props for the {@link LinearRescale} shader module.
 */
export type LinearRescaleProps = {
  /** Minimum input value (maps to 0.0 in output). */
  rescaleMin: number;
  /** Maximum input value (maps to 1.0 in output). */
  rescaleMax: number;
};

const MODULE_NAME = "linearRescale";

/**
 * A shader module that linearly rescales RGB color values from
 * `[min, max]` to `[0, 1]`, clamping values outside the range.
 *
 * Useful for normalizing data like Sentinel-2 reflectance (0-10000 stored
 * as uint16) into a visible range after `r16unorm` normalization maps
 * them to approximately 0.0-0.15.
 *
 * @example
 * ```ts
 * // Sentinel-2 L2A: reflectance 0-10000 → r16unorm 0.0-0.153
 * { module: LinearRescale, props: { rescaleMin: 0, rescaleMax: 0.15 } }
 * ```
 */
export const LinearRescale = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  float rescaleMin;
  float rescaleMax;
} ${MODULE_NAME};
`,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
  color.rgb = clamp((color.rgb - ${MODULE_NAME}.rescaleMin) / (${MODULE_NAME}.rescaleMax - ${MODULE_NAME}.rescaleMin), 0.0, 1.0);
`,
  },
  uniformTypes: {
    rescaleMin: "f32",
    rescaleMax: "f32",
  },
  getUniforms: (props: Partial<LinearRescaleProps>) => {
    return {
      rescaleMin: props.rescaleMin ?? 0.0,
      rescaleMax: props.rescaleMax ?? 1.0,
    };
  },
} as const satisfies ShaderModule<LinearRescaleProps>;
