import type {
  DefaultProps,
  TextureSource,
  UpdateParameters,
} from "@deck.gl/core";
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
  image: { type: "image", value: null, async: true },
  renderPipeline: { type: "array", value: [], compare: true },
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

  state!: SimpleMeshLayer["state"] & {
    renderPipeline: RasterModule[];
  };

  override initializeState(): void {
    super.initializeState();

    this.setState({ renderPipeline: this._resolveRenderPipeline() });
  }

  override updateState(params: UpdateParameters<this>): void {
    super.updateState(params);

    const { image, renderPipeline } = this.props;
    const prevImage = params.oldProps.image;
    const prevRenderPipeline = params.oldProps.renderPipeline;

    if (image !== prevImage || renderPipeline !== prevRenderPipeline) {
      this.setState({ renderPipeline: this._resolveRenderPipeline() });
    }
  }

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
    for (const m of this.state.renderPipeline) {
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
    for (const m of this.state.renderPipeline) {
      // Props should be keyed by module name
      shaderProps[m.module.name] = m.props || {};
    }

    for (const m of super.getModels()) {
      m.shaderInputs.setProps(shaderProps);
    }

    super.draw(opts);
  }
}
