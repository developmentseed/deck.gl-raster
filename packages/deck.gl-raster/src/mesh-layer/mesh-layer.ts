import type { SimpleMeshLayerProps } from "@deck.gl/mesh-layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { ShaderModule } from "@luma.gl/shadertools";
import type { RasterModule } from "../gpu-modules/types.js";
import fs from "./mesh-layer-fragment.glsl.js";

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
    // Build props and collect texture bindings in a single pass
    const shaderProps: Record<string, Record<string, unknown>> = {};
    const textureBindings: Record<string, unknown> = {};

    for (const m of this.props.renderPipeline) {
      shaderProps[m.module.name] = m.props || {};

      if (m.module.getUniforms && m.props) {
        for (const [key, value] of Object.entries(
          m.module.getUniforms(m.props),
        )) {
          // Textures have a "handle" property
          if (value && typeof value === "object" && "handle" in value) {
            textureBindings[key] = value;
          }
        }
      }
    }

    for (const model of super.getModels()) {
      // uniformTypes enables setProps to handle uniform block values
      model.shaderInputs.setProps(shaderProps);
      // Textures must be set via bindings (can't go in uniform blocks)
      model.setBindings(textureBindings as Record<string, any>);
    }

    super.draw(opts);
  }
}
