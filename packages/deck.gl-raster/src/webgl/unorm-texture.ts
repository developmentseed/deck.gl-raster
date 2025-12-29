import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

const uniformBlock = `\
  uniform sampler2D textureName;
`;

// Props expected by the TextureModule shader module
export type TextureModuleProps = {
  textureName: Texture;
};

/**
 * An example shader module that injects a unorm texture and uses a sampler2D to
 * assign to a color.
 */
export const TextureModule = {
  name: "moduleName",
  // fs: uniformBlock,
  inject: {
    "fs:#decl": uniformBlock,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = texture(textureName, geometry.uv);
    `,
  },
  getUniforms: (props: Partial<TextureModuleProps>) => {
    console.log("UNormTexture.getUniforms", props);
    return {
      textureName: props.textureName,
    };
  },
} as const satisfies ShaderModule<TextureModuleProps>;
