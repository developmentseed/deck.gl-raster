import type { SimpleMeshLayerProps } from "@deck.gl/mesh-layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import fs from "./mesh-layer-fragment.glsl.js";

import type { ShaderModule } from "@luma.gl/shadertools";
import type { RasterModule } from "../webgl/types.js";

export interface MeshTextureLayerProps extends SimpleMeshLayerProps {
  renderPipeline: RasterModule[];
  // shaders?: {
  //   inject?: {
  //     "fs:#decl"?: string;
  //     "fs:DECKGL_FILTER_COLOR"?: string;
  //   };
  //   modules?: ShaderModule[];
  //   shaderProps?: { [x: string]: Partial<Record<string, unknown> | undefined> };
  // };
}

/**
 * A small subclass of the SimpleMeshLayer to allow dynamic shader injections.
 *
 * In the future this may expand to diverge more from the SimpleMeshLayer, such
 * as allowing the texture to be a 2D _array_.
 */
export class MeshTextureLayer extends SimpleMeshLayer<
  null,
  MeshTextureLayerProps
> {
  static override layerName = "mesh-texture-layer";
  static override defaultProps: typeof SimpleMeshLayer.defaultProps =
    SimpleMeshLayer.defaultProps;

  override getShaders() {
    const upstreamShaders = super.getShaders();

    const shaderModules: ShaderModule[] = this.props.renderPipeline.map(
      (m) => m.module,
    );

    return {
      ...upstreamShaders,
      // Override upstream's fragment shader with our copy with modified
      // injection points
      fs,
      // inject: {
      //   ...upstreamShaders.inject,
      //   ...this.props.shaders?.inject,
      // },
      modules: [...upstreamShaders.modules, ...shaderModules],
    };
  }

  override draw(opts: any): void {
    const shaderProps: { [x: string]: Partial<Record<string, unknown>> } = {};
    for (const m of this.props.renderPipeline) {
      // TODO: validate that keys are unique
      Object.assign(shaderProps, m.props);
    }

    for (const m of super.getModels()) {
      m.shaderInputs.setProps(shaderProps);
    }

    super.draw(opts);
  }
}
