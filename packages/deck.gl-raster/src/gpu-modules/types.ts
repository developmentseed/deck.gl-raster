import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

export type RasterModule<
  PropsT extends Record<string, number | Texture> = Record<
    string,
    number | Texture
  >,
> = {
  module: ShaderModule<PropsT>;
  props?: Partial<PropsT>;
};
