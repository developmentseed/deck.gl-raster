import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Allowed prop value types for shader modules: scalars, typed tuples
 * (matching luma.gl's internal `UniformValue`), or texture bindings.
 */
type RasterModulePropValue = number | boolean | readonly number[] | Texture;

/**
 * A shader module paired with its props, forming one step in a render pipeline.
 */
export type RasterModule<
  PropsT extends Record<string, RasterModulePropValue> = Record<
    string,
    RasterModulePropValue
  >,
> = {
  module: ShaderModule<PropsT>;
  props?: Partial<PropsT>;
};
