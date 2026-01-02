import type { ShaderModule } from "@luma.gl/shadertools";

export type RasterModule<
  PropsT extends Record<string, any> = Record<string, any>,
> = {
  id: string;
  module: ShaderModule<PropsT>;
  props: Partial<PropsT>;
};
