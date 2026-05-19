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

describe("RasterLayer.referencePointMeters", () => {
  function makeBareLayerWithRef(referencePointMeters: [number, number] | null) {
    const layer = new RasterLayer({
      id: "test",
      width: 4,
      height: 4,
      reprojectionFns: REPROJECTION_FNS,
      image: {} as never,
      referencePointMeters: referencePointMeters ?? undefined,
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

  it("writes positions unchanged when referencePointMeters is omitted", () => {
    const { layer: layerA, internalState: stateA } = makeBareLayerWithRef(null);
    const { layer: layerB, internalState: stateB } = makeBareLayerWithRef(null);

    (layerA as unknown as { _generateMesh: () => void })._generateMesh();
    (layerB as unknown as { _generateMesh: () => void })._generateMesh();

    const posA = (stateA.mesh as WrappedMesh).attributes.POSITION.value;
    const posB = (stateB.mesh as WrappedMesh).attributes.POSITION.value;
    expect(Array.from(posA)).toEqual(Array.from(posB));
  });

  it("stores Float32 offsets when referencePointMeters is provided", () => {
    // Simulate a high-zoom tile centered at ~13M meters in 3857 (somewhere in
    // North America). Without reference subtraction, float32 quantization at
    // this magnitude is ~1-2 m. With subtraction, offsets are small (< 10 m)
    // and float32 precision is ample.
    const REF_X = 13_000_000;
    const REF_Y = 4_500_000;
    const SUB = 0.3; // 30 cm/pixel — typical NAIP-class resolution.
    const fns: ReprojectionFns = {
      forwardTransform: identity,
      inverseTransform: identity,
      forwardReproject: (px, py) => [REF_X + px * SUB, REF_Y + py * SUB],
      inverseReproject: (x, y) => [(x - REF_X) / SUB, (y - REF_Y) / SUB],
    };

    const layer = new RasterLayer({
      id: "test",
      width: 4,
      height: 4,
      reprojectionFns: fns,
      image: {} as never,
      referencePointMeters: [REF_X, REF_Y],
    });
    const internalState: Record<string, unknown> = {};
    Object.assign(layer as object, { state: internalState });
    Object.assign(layer as object, {
      setState: (updates: Record<string, unknown>) =>
        Object.assign(internalState, updates),
      getSubLayerProps: <T>(props: T) => props,
    });

    (layer as unknown as { _generateMesh: () => void })._generateMesh();

    const positions = (internalState.mesh as WrappedMesh).attributes.POSITION
      .value;
    // Every stored x/y should be a small offset (≤ a few meters), not the
    // absolute 13M-meter magnitude.
    for (let i = 0; i < positions.length; i += 3) {
      expect(Math.abs(positions[i]!)).toBeLessThan(10);
      expect(Math.abs(positions[i + 1]!)).toBeLessThan(10);
    }
  });
});
