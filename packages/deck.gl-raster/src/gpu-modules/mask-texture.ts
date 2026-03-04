import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

// Props expected by the MaskTexture shader module
export type MaskTextureProps = {
  maskTexture: Texture;
};

/**
 * A shader module that injects a unorm texture and uses a sampler2D to assign
 * to a color.
 */
export const MaskTexture = {
  name: "mask-texture",
  inject: {
    "fs:#decl": `uniform sampler2D maskTexture;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float maskValue = texture(maskTexture, geometry.uv).r;
      if (maskValue == 0.0) {
        discard;
      }
    `,
  },
  getUniforms: (props: Partial<MaskTextureProps>) => {
    return {
      maskTexture: props.maskTexture,
    };
  },
} as const satisfies ShaderModule<MaskTextureProps>;
