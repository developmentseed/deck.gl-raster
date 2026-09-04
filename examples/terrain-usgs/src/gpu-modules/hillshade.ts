import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Writes the sun-shading factor from {@link TerrainDerivative} as a grayscale
 * color.
 *
 * Pipeline contract:
 * - Reads: `float shade`, `bool valid`
 * - Writes: `vec4 color`
 */
export const Hillshade = {
  name: "hillshade",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
  if (!valid) {
    discard;
  }
  color = vec4(vec3(shade), 1.0);
`,
  },
} as const satisfies ShaderModule;
