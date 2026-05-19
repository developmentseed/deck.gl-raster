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
import { assertFp64Invariants } from "./assert-fp64-invariants.js";
import fs from "./mesh-layer-fragment.glsl.js";
import vs from "./mesh-layer-vertex.glsl.js";

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
 * A small subclass of the SimpleMeshLayer to allow dynamic shader injections
 * and to provide fp64 mesh-vertex precision via a `positions64Low`
 * attribute paired with the geometry's `positions`.
 *
 * The fp64 correction is only valid for a single non-instanced mesh with
 * identity per-instance transforms. `updateState` asserts this in
 * development mode (see `assertFp64Invariants`).
 */
export class MeshTextureLayer extends SimpleMeshLayer<
  null,
  MeshTextureLayerProps
> {
  static override layerName = "mesh-texture-layer";
  static override defaultProps: typeof defaultProps = defaultProps;

  override initializeState(): void {
    super.initializeState();
    const attributeManager = this.getAttributeManager();
    if (attributeManager) {
      // Register the per-vertex low part of the fp64 position split. The
      // buffer is supplied by the caller through `data.attributes.positions64Low`
      // (deck.gl 9.x removed the `props.<attrName>` channel for attribute
      // values — see attribute-manager.ts:196). We declare `noAlloc` so the
      // AttributeManager doesn't try to materialize the buffer itself; it
      // takes the external buffer directly via `setExternalBuffer`.
      attributeManager.add({
        positions64Low: {
          size: 3,
          type: "float32",
          noAlloc: true,
        },
      });
    }
  }

  _resolveRenderPipeline(): RasterModule[] {
    const { image, renderPipeline } = this.props;
    const imageModule: RasterModule[] = image
      ? [{ module: CreateTexture, props: { textureName: image as Texture } }]
      : [];
    return [...imageModule, ...(renderPipeline ?? [])];
  }

  override updateState(params: UpdateParameters<this>): void {
    // Ensure the SimpleMeshLayer rebuilds the model when the renderPipeline has
    // changed.
    if (this.hasRenderPipelineChanged(params)) {
      // Setting extensionsChanged to true causes recompiling the shader
      // https://github.com/visgl/deck.gl/blob/70adde2f1fcdf5e99195df81512e6d01ee7a5edc/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer.ts#L284-L297
      params.changeFlags.extensionsChanged = true;
    }

    super.updateState(params);

    // Dev-mode assertion: the fp64 mesh-vertex correction is only valid for a
    // single non-instanced mesh with identity per-instance transforms. See
    // dev-docs/specs/2026-05-19-high-zoom-precision-design.md § Invariant.
    if (process.env.NODE_ENV !== "production") {
      assertFp64Invariants(params.props);
    }
  }

  /** Returns true if the render pipeline has changed between the old and new props. */
  private hasRenderPipelineChanged(params: UpdateParameters<this>): boolean {
    const { oldProps, props: newProps } = params;
    if (Boolean(oldProps.image) !== Boolean(newProps.image)) {
      return true;
    }

    const oldPipeline = oldProps.renderPipeline ?? [];
    const newPipeline = newProps.renderPipeline ?? [];
    if (oldPipeline.length !== newPipeline.length) {
      return true;
    }

    for (let i = 0; i < oldPipeline.length; i++) {
      if (oldPipeline[i]?.module.name !== newPipeline[i]?.module.name) {
        return true;
      }
    }

    return false;
  }

  override getShaders() {
    const upstreamShaders = super.getShaders();

    const modules: ShaderModule[] = upstreamShaders.modules;
    for (const m of this._resolveRenderPipeline()) {
      modules.push(m.module);
    }

    return {
      ...upstreamShaders,
      // Override upstream's vertex shader with our copy that declares a
      // `positions64Low` attribute and uses it in the project_position_to_clipspace
      // call to restore fp64 mesh-vertex precision. See
      // dev-docs/specs/2026-05-19-high-zoom-precision-design.md.
      vs,
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
