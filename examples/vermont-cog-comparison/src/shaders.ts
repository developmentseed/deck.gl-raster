import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Shader module that forces alpha to 1.0.
 *
 * VT 4-band imagery uses the 4th band as near-infrared (NIR), not alpha,
 * so the texture's alpha channel is the NIR value and the image would
 * render mostly transparent without this override.
 */
export const SetAlpha1 = {
  name: "set-alpha-1",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = vec4(color.rgb, 1.0);
    `,
  },
} as const satisfies ShaderModule;

/**
 * Shader module that reorders RGB+NIR bands into a false-color infrared
 * composite (NIR → red, red → green, green → blue).
 *
 * @see https://www.usgs.gov/media/images/common-landsat-band-combinations
 */
export const SetFalseColorInfrared = {
  name: "set-false-color-infrared",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float nir = color[3];
      float red = color[0];
      float green = color[1];
      color.rgb = vec3(nir, red, green);
    `,
  },
} as const satisfies ShaderModule;

/**
 * Shader module that computes NDVI = (NIR - red) / (NIR + red), then maps
 * the result into the red channel as a value in [0, 1] suitable for a
 * Colormap module to sample. Other channels are left untouched.
 */
export const Ndvi = {
  name: "ndvi",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float nir = color[3];
      float red = color[0];
      float ndvi = (nir - red) / (nir + red);
      color.r = (ndvi + 1.0) / 2.0;
    `,
  },
} as const satisfies ShaderModule;
