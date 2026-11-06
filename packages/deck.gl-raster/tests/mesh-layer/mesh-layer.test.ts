import { LayerManager } from "@deck.gl/core";
import type { Device } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import { describe, expect, it, vi } from "vitest";
import type { MeshTextureLayerProps } from "../../src/mesh-layer/mesh-layer.js";
import { MeshTextureLayer } from "../../src/mesh-layer/mesh-layer.js";

/** A luma.gl `VertexArray` stand-in that records being destroyed. */
function makeVertexArray() {
  const vertexArray = {
    destroyed: false,
    destroy: vi.fn(() => {
      vertexArray.destroyed = true;
    }),
  };
  return vertexArray;
}

/**
 * A luma.gl `Model` stand-in. Like luma.gl 9.4.2's, its `destroy()` leaves its
 * vertex array alive.
 */
function makeModel() {
  return {
    vertexArray: makeVertexArray(),
    destroy: () => {},
    // Called by deck.gl as it updates the layer
    setTopology: () => {},
    setAttributes: () => {},
    setConstantAttributes: () => {},
    shaderInputs: { setProps: () => {} },
  };
}

type FakeModel = ReturnType<typeof makeModel>;

/** {@link MeshTextureLayer} with stand-in models, which need no GPU. */
class FakeModelMeshTextureLayer extends MeshTextureLayer {
  static override layerName = "FakeModelMeshTextureLayer";

  protected override getModel(): any {
    return makeModel();
  }
}

const MESH = {
  attributes: { positions: { value: new Float32Array(9), size: 3 } },
};

/**
 * Render {@link MeshTextureLayer} through deck.gl's {@link LayerManager}. Each
 * call of `render` renders a new layer instance with the given props, as apps
 * do on every render, and returns the layer's model. `remove` renders no
 * layers.
 */
function makeRenderer() {
  // The GPU resources deck.gl creates for the layer besides its model
  const device = {
    createTexture: () => ({ delete: () => {} }),
    createBuffer: () => ({ write: () => {}, delete: () => {} }),
  } as unknown as Device;
  const layerManager = new LayerManager(device, {});
  // Fail the test on layer lifecycle errors, which deck.gl catches
  layerManager.setProps({
    onError: (error: Error) => {
      throw error;
    },
  });

  const render = (
    props: Partial<Pick<MeshTextureLayerProps, "mesh" | "renderPipeline">> = {},
  ): FakeModel => {
    const layer = new FakeModelMeshTextureLayer({
      id: "mesh",
      mesh: MESH,
      renderPipeline: [],
      ...props,
    });
    layerManager.setLayers([layer]);
    return layer.getModels()[0] as unknown as FakeModel;
  };
  const remove = () => layerManager.setLayers([]);
  return { render, remove };
}

describe("MeshTextureLayer vertex arrays", () => {
  it("destroys its model's vertex array when the layer is removed", () => {
    const { render, remove } = makeRenderer();
    const model = render();
    remove();
    expect(model.vertexArray.destroyed).toBe(true);
  });

  it.each([
    ["the mesh changes", { mesh: { ...MESH } }],
    [
      "the render pipeline changes",
      { renderPipeline: [{ module: { name: "filter" } as ShaderModule }] },
    ],
  ])("destroys the old model's vertex array when %s", (_, newProps) => {
    const { render } = makeRenderer();
    const oldModel = render();
    const newModel = render(newProps);
    expect(oldModel.vertexArray.destroyed).toBe(true);
    expect(newModel.vertexArray.destroyed).toBe(false);
  });

  it("destroys a vertex array only once when Model.destroy() also destroys it", () => {
    const { render, remove } = makeRenderer();
    const model = render();
    // As luma.gl's Model.destroy() will once it destroys its vertex array
    model.destroy = () => model.vertexArray.destroy();
    remove();
    expect(model.vertexArray.destroy).toHaveBeenCalledTimes(1);
  });
});
