import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

// Props expected by the CreateTextureBands shader module.
// Each band is a single-channel (depth=1) texture. Unused bands should be
// omitted — the shader reads only the bands that are declared.
export type CreateTextureBandsProps = {
  band1: Texture;
  band2?: Texture;
  band3?: Texture;
  band4?: Texture;
};

/**
 * A shader module that assembles up to four single-band textures into a single
 * vec4 color. Each input texture is expected to have a single channel; the red
 * channel (.r) of each is read and placed into the corresponding RGBA slot.
 *
 * Bands are always read in order: band1 → R, band2 → G, band3 → B, band4 → A.
 * Missing bands default to 0.0.
 */
export const CreateTextureBands = {
  name: "create-texture-bands",
  inject: {
    "fs:#decl": /* glsl */ `
      uniform sampler2D band1;
      uniform sampler2D band2;
      uniform sampler2D band3;
      uniform sampler2D band4;
      uniform int bandCount;
    `,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float r = texture(band1, geometry.uv).r;
      float g = bandCount >= 2 ? texture(band2, geometry.uv).r : 0.0;
      float b = bandCount >= 3 ? texture(band3, geometry.uv).r : 0.0;
      float a = bandCount >= 4 ? texture(band4, geometry.uv).r : 1.0;
      color = vec4(r, g, b, a);
    `,
  },
  getUniforms: (props: Partial<CreateTextureBandsProps>) => {
    const count =
      props.band4 != null
        ? 4
        : props.band3 != null
          ? 3
          : props.band2 != null
            ? 2
            : 1;
    return {
      band1: props.band1,
      band2: props.band2,
      band3: props.band3,
      band4: props.band4,
      bandCount: count,
    };
  },
} as const satisfies ShaderModule<CreateTextureBandsProps>;
