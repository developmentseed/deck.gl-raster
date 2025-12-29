import type { SimpleMeshLayerProps } from "@deck.gl/mesh-layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { TextureModule } from "../webgl/unorm-texture.js";
import fs from "./mesh-layer-fragment.glsl.js";

import type { ShaderModule } from "@luma.gl/shadertools";

export interface MeshTextureLayerProps extends SimpleMeshLayerProps {
  shaders?: {
    inject?: {
      "fs:#decl"?: string;
      "fs:DECKGL_FILTER_COLOR"?: string;
    };
    modules?: ShaderModule[];
    shaderProps?: { [x: string]: Partial<Record<string, unknown> | undefined> };
  };
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

    return {
      ...upstreamShaders,
      // Override upstream's fragment shader with our copy with modified
      // injection points
      fs,
      inject: {
        ...upstreamShaders.inject,
        ...this.props.shaders?.inject,
      },
      modules: [
        ...upstreamShaders.modules,
        ...(this.props.shaders?.modules || []),
        // Hard-coded addition of our texture module for this example.
        // Remove before merging.
        TextureModule,
      ],
    };
  }

  override draw(opts: any): void {
    if (this.props.shaders?.shaderProps)
      for (const m of super.getModels()) {
        m.shaderInputs.setProps(this.props.shaders.shaderProps);
      }

    super.draw(opts);
  }
}
