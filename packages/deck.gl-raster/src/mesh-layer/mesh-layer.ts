import type { SimpleMeshLayerProps } from "@deck.gl/mesh-layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import fs from "./mesh-layer-fragment.glsl.js";

import type { ShaderModule } from "@luma.gl/shadertools";
import type { RasterModule } from "../webgl/types.js";

export interface MeshTextureLayerProps extends SimpleMeshLayerProps {
  renderPipeline: RasterModule[];
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

    const modules: ShaderModule[] = upstreamShaders.modules;
    for (const m of this.props.renderPipeline) {
      modules.push(m.module);
    }

    return {
      ...upstreamShaders,
      // Override upstream's fragment shader with our copy with modified
      // injection points
      fs,
      modules,
    };
  }

  override draw(opts: any): void {
    const shaderProps: { [x: string]: Partial<Record<string, unknown>> } = {};
    for (const m of this.props.renderPipeline) {
      // Props should be keyed by module name
      shaderProps[m.module.name] = m.props;
    }

    for (const m of super.getModels()) {
      m.shaderInputs.setProps(shaderProps);
    }

    super.draw(opts);
  }
}
