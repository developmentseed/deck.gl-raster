import type { DefaultProps, TextureSource } from "@deck.gl/core";
import type { SimpleMeshLayerProps } from "@deck.gl/mesh-layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import { CreateTexture } from "../gpu-modules/create-texture.js";
import type { RasterModule } from "../gpu-modules/types.js";
import fs from "./mesh-layer-fragment.glsl.js";

type _MeshTextureLayerProps =
  | { image: TextureSource; renderPipeline?: RasterModule[] }
  | { renderPipeline: RasterModule[]; image?: TextureSource };

export type MeshTextureLayerProps = SimpleMeshLayerProps &
  _MeshTextureLayerProps;

const defaultProps: DefaultProps<
  SimpleMeshLayerProps & {
    image: TextureSource | null;
    renderPipeline: RasterModule[];
  }
> = {
  ...SimpleMeshLayer.defaultProps,
  // Note: putting `image` in defaultProps causes Maplibre to fail to render
  // labels in interleaved mode 🤷‍♂️
  // image: { type: "image", value: null, async: true },
  renderPipeline: { type: "array", value: [], compare: true },
  // Disable lighting by default (avoids darkening raster)
  material: {
    ambient: 1.0,
    diffuse: 0.0,
    shininess: 0,
    specularColor: [0, 0, 0],
  },
};

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
  static override defaultProps: typeof defaultProps = defaultProps;

  _resolveRenderPipeline(): RasterModule[] {
    const { image, renderPipeline } = this.props;
    const imageModule: RasterModule[] = image
      ? [{ module: CreateTexture, props: { textureName: image as Texture } }]
      : [];
    return [...imageModule, ...(renderPipeline ?? [])];
  }

  override getShaders() {
    const upstreamShaders = super.getShaders();

    const modules: ShaderModule[] = upstreamShaders.modules;
    for (const m of this._resolveRenderPipeline()) {
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
    for (const m of this._resolveRenderPipeline()) {
      // Props should be keyed by module name
      shaderProps[m.module.name] = m.props || {};
    }

    for (const m of super.getModels()) {
      m.shaderInputs.setProps(shaderProps);
    }

    super.draw(opts);
  }
}
