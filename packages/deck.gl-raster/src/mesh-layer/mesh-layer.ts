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
    // Build props object keyed by module name for shaderInputs
    // With proper uniformTypes, setProps should handle non-texture uniforms
    const shaderProps: Record<string, Record<string, unknown>> = {};
    for (const m of this.props.renderPipeline) {
      shaderProps[m.module.name] = m.props || {};
    }

    // Collect texture bindings from modules (textures can't go in uniform blocks)
    const textureBindings: Record<string, unknown> = {};
    for (const m of this.props.renderPipeline) {
      if (m.module.getUniforms && m.props) {
        const moduleUniforms = m.module.getUniforms(m.props);
        for (const [key, value] of Object.entries(moduleUniforms)) {
          if (value && typeof value === "object" && "handle" in value) {
            textureBindings[key] = value;
          }
        }
      }
    }

    for (const model of super.getModels()) {
      // setProps should handle uniform block values via uniformTypes
      model.shaderInputs.setProps(shaderProps);

      // Textures need to be set via bindings (can't be in uniform blocks)
      if (Object.keys(textureBindings).length > 0) {
        model.setBindings(textureBindings as Record<string, any>);
      }
    }

    super.draw(opts);
  }
}
