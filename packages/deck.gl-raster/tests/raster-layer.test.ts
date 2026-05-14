import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/mesh-layer/mesh-layer.js", () => ({
  MeshTextureLayer: class CapturingMeshTextureLayer {
    public props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  },
}));

const { RasterLayer } = await import("../src/raster-layer.js");

const identity = (x: number, y: number): [number, number] => [x, y];
const REPROJECTION_FNS: ReprojectionFns = {
  forwardTransform: identity,
  inverseTransform: identity,
  forwardReproject: identity,
  inverseReproject: identity,
};

/**
 * Build a {@link RasterLayer} ready for direct lifecycle invocation: bypasses
 * deck.gl's `LayerManager` by replacing `state` and `setState` with a plain
 * object + assign, and short-circuits `getSubLayerProps` so MeshTextureLayer
 * receives the exact prop shape we hand it.
 */
function makeBareLayer() {
  const layer = new RasterLayer({
    id: "test",
    width: 4,
    height: 4,
    reprojectionFns: REPROJECTION_FNS,
    image: {} as never,
  });
  const internalState: Record<string, unknown> = {};
  Object.assign(layer as object, { state: internalState });
  Object.assign(layer as object, {
    setState: (updates: Record<string, unknown>) =>
      Object.assign(internalState, updates),
    getSubLayerProps: <T>(props: T) => props,
  });
  return { layer, internalState };
}

type WrappedMesh = {
  indices: { value: Uint32Array; size: number };
  attributes: {
    POSITION: { value: Float32Array; size: number };
    TEXCOORD_0: { value: Float32Array; size: number };
  };
};

describe("RasterLayer.state.mesh", () => {
  it("stores the mesh in SimpleMeshLayer's expected wrapper shape", () => {
    const { layer, internalState } = makeBareLayer();

    (layer as unknown as { _generateMesh: () => void })._generateMesh();

    const mesh = internalState.mesh as WrappedMesh;
    expect(mesh.indices.value).toBeInstanceOf(Uint32Array);
    expect(mesh.indices.size).toBe(1);
    expect(mesh.attributes.POSITION.value).toBeInstanceOf(Float32Array);
    expect(mesh.attributes.POSITION.size).toBe(3);
    expect(mesh.attributes.TEXCOORD_0.value).toBeInstanceOf(Float32Array);
    expect(mesh.attributes.TEXCOORD_0.size).toBe(2);
  });

  it("passes state.mesh to MeshTextureLayer by reference across renders", () => {
    const { layer, internalState } = makeBareLayer();

    (layer as unknown as { _generateMesh: () => void })._generateMesh();
    const meshRef = internalState.mesh;

    const renderOnce = layer as unknown as {
      renderLayers: () => { props: { mesh: unknown } }[];
    };
    const layers1 = renderOnce.renderLayers();
    const layers2 = renderOnce.renderLayers();

    expect(layers1[0]!.props.mesh).toBe(meshRef);
    expect(layers2[0]!.props.mesh).toBe(meshRef);
    expect(layers1[0]!.props.mesh).toBe(layers2[0]!.props.mesh);
  });
});
