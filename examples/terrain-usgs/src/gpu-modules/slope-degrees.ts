import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Writes slope in degrees (0–90) to every channel of `color`, for a
 * downstream `LinearRescale` + `Colormap` to colorize.
 *
 * All three channels are written because `LinearRescale` operates on
 * `color.rgb` while `Colormap` indexes on `color.r`.
 *
 * Pipeline contract:
 * - Reads: `float slopeDegrees`, `bool valid`
 * - Writes: `vec4 color`
 */
export const SlopeDegrees = {
  name: "slope-degrees",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
  if (!valid) {
    discard;
  }
  color = vec4(vec3(slopeDegrees), 1.0);
`,
  },
} as const satisfies ShaderModule;
