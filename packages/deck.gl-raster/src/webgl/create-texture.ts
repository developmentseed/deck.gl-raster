import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

// Props expected by the CreateTextureUnorm shader module
export type CreateTextureUnormProps = {
  textureName: Texture;
};

/**
 * A shader module that injects a unorm texture and uses a sampler2D to assign
 * to a color.
 */
export const CreateTextureUnorm = {
  name: "create-texture-unorm",
  inject: {
    "fs:#decl": `uniform sampler2D textureName;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = texture(textureName, geometry.uv);
    `,
  },
  getUniforms: (props: Partial<CreateTextureUnormProps>) => {
    return {
      textureName: props.textureName,
    };
  },
} as const satisfies ShaderModule<CreateTextureUnormProps>;
