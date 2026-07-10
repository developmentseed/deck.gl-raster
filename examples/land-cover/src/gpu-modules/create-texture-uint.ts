import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/** Props for the {@link CreateTextureUint} shader module. */
export type CreateTextureUintProps = {
  /** Source `r8uint` texture to sample. */
  textureName: Texture;
};

/**
 * Samples an integer-typed source texture and introduces an `ivec4 icolor`
 * function-local for downstream integer-aware modules to consume.
 *
 * Pipeline contract:
 * - Writes: `ivec4 icolor` (function-local, scoped to `DECKGL_FILTER_COLOR`)
 * - Reads: nothing
 * - Does not touch `color` — a downstream module must write `color`.
 *
 * Replaces the default `CreateTexture` module for the integer-aware
 * land-cover pipeline.
 */
export const CreateTextureUint = {
  name: "create-texture-uint",
  inject: {
    "fs:#decl": `uniform highp usampler2D textureName;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      ivec4 icolor = ivec4(texture(textureName, geometry.uv));
    `,
  },
  getUniforms: (props: Partial<CreateTextureUintProps>) => {
    return {
      textureName: props.textureName,
    };
  },
} as const satisfies ShaderModule<CreateTextureUintProps>;
