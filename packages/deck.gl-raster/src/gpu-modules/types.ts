import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/** Supported uniform value types (scalars, vec2/3/4, booleans, and textures) */
export type UniformValue = number | number[] | boolean | Texture;

export type RasterModule<
  PropsT extends Record<string, UniformValue> = Record<string, UniformValue>,
> = {
  module: ShaderModule<PropsT>;
  props?: Partial<PropsT>;
};
