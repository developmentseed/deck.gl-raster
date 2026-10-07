import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Writes raw elevation (in the source's vertical units, meters for USGS 3DEP)
 * to every channel of `color`, for a downstream `LinearRescale` + `Colormap`
 * to colorize.
 *
 * Pipeline contract:
 * - Reads: `float elevation`, `bool valid`
 * - Writes: `vec4 color`
 */
export const ElevationScalar = {
  name: "elevation-scalar",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
  if (!valid) {
    discard;
  }
  color = vec4(vec3(elevation), 1.0);
`,
  },
} as const satisfies ShaderModule;
