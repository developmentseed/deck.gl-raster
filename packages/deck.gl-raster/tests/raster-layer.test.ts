import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { describe, expect, it, vi } from "vitest";
import type { RasterLayerProps } from "../src/raster-layer.js";

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
function makeBareLayer(extra: Partial<RasterLayerProps> = {}) {
  const layer = new RasterLayer({
    id: "test",
    width: 4,
    height: 4,
    reprojectionFns: REPROJECTION_FNS,
    image: {} as never,
    ...extra,
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

describe("RasterLayer mesh fp64 split", () => {
  it("produces a positions64Low Float32Array on state, same length as POSITION", () => {
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

    (layer as unknown as { _generateMesh: () => void })._generateMesh();

    const mesh = internalState.mesh as WrappedMesh;
    const low = internalState.positions64Low as Float32Array;
    expect(low).toBeInstanceOf(Float32Array);
    expect(low.length).toBe(mesh.attributes.POSITION.value.length);
  });

  it("encodes high + low so reconstruction matches the float64 original to < 1e-6 m at high magnitude", () => {
    const REF_X = 13_000_000;
    const REF_Y = 4_500_000;
    const SUB = 0.3;
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
    });
    const internalState: Record<string, unknown> = {};
    Object.assign(layer as object, { state: internalState });
    Object.assign(layer as object, {
      setState: (updates: Record<string, unknown>) =>
        Object.assign(internalState, updates),
      getSubLayerProps: <T>(props: T) => props,
    });

    (layer as unknown as { _generateMesh: () => void })._generateMesh();

    const reprojector = internalState.reprojector as {
      exactOutputPositions: number[];
    };
    const positions = (internalState.mesh as WrappedMesh).attributes.POSITION
      .value;
    const low = internalState.positions64Low as Float32Array;

    const numVertices = reprojector.exactOutputPositions.length / 2;
    for (let i = 0; i < numVertices; i++) {
      const vx = reprojector.exactOutputPositions[i * 2]!;
      const vy = reprojector.exactOutputPositions[i * 2 + 1]!;
      const reconX = positions[i * 3]! + low[i * 3]!;
      const reconY = positions[i * 3 + 1]! + low[i * 3 + 1]!;
      expect(Math.abs(reconX - vx)).toBeLessThan(1e-6);
      expect(Math.abs(reconY - vy)).toBeLessThan(1e-6);
    }

    for (let i = 0; i < numVertices; i++) {
      const vx = reprojector.exactOutputPositions[i * 2]!;
      const highOnlyErr = Math.abs(positions[i * 3]! - vx);
      expect(highOnlyErr).toBeLessThan(2);
    }
  });
});

describe("RasterLayer debug overlay", () => {
  it("outlines each triangle of the mesh", () => {
    // Far from the origin, where a float32 alone can't hold the positions.
    const { layer, internalState } = makeBareLayer({
      reprojectionFns: {
        ...REPROJECTION_FNS,
        forwardReproject: (x, y) => [13_000_000 + x * 0.3, 4_500_000 + y * 0.3],
      },
    });
    const bare = layer as unknown as {
      _generateMesh: () => void;
      renderDebugLayer: () => {
        props: {
          data: { length: number };
          getPolygon: (
            object: unknown,
            info: { index: number; data: unknown },
          ) => [number, number][];
        };
      };
    };
    bare._generateMesh();
    const { exactOutputPositions: positions, triangles } =
      internalState.reprojector as {
        exactOutputPositions: number[];
        triangles: number[];
      };
    const { data, getPolygon } = bare.renderDebugLayer().props;
    expect(data.length).toBe(triangles.length / 3);
    for (let index = 0; index < data.length; index++) {
      const polygon = getPolygon(null, { index, data });
      [0, 1, 2, 0].forEach((corner, j) => {
        const vertex = triangles[index * 3 + corner]!;
        expect(polygon[j]![0]).toBeCloseTo(positions[vertex * 2]!, 6);
        expect(polygon[j]![1]).toBeCloseTo(positions[vertex * 2 + 1]!, 6);
      });
    }
  });
});

describe("RasterLayer._errorSpace", () => {
  it("passes _errorSpace to the reprojector", () => {
    const { layer, internalState } = makeBareLayer({ _errorSpace: "output" });
    (layer as unknown as { _generateMesh: () => void })._generateMesh();
    const reprojector = internalState.reprojector as { _errorSpace: string };
    expect(reprojector._errorSpace).toBe("output");
  });

  it("rebuilds the mesh when _errorSpace changes", () => {
    const { layer } = makeBareLayer();
    const bare = layer as unknown as {
      props: RasterLayerProps;
      _generateMesh: () => void;
      updateState: (params: unknown) => void;
    };
    const generate = vi
      .spyOn(bare, "_generateMesh")
      .mockImplementation(() => {});
    bare.updateState({
      props: { ...bare.props, _errorSpace: "output" },
      oldProps: { ...bare.props, _errorSpace: "input" },
      changeFlags: {},
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("keeps the mesh when _errorSpace is unchanged", () => {
    const { layer } = makeBareLayer({ _errorSpace: "output" });
    const bare = layer as unknown as {
      props: RasterLayerProps;
      _generateMesh: () => void;
      updateState: (params: unknown) => void;
    };
    const generate = vi
      .spyOn(bare, "_generateMesh")
      .mockImplementation(() => {});
    bare.updateState({
      props: { ...bare.props },
      oldProps: { ...bare.props },
      changeFlags: {},
    });
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("RasterLayer mesh errors", () => {
  /**
   * A layer whose mesh can't be built (output mode can't measure a pixel size
   * where the projection doesn't move), holding a mesh from earlier props.
   */
  function makeFailingLayer() {
    const { layer, internalState } = makeBareLayer({
      reprojectionFns: { ...REPROJECTION_FNS, forwardReproject: () => [0, 0] },
      _errorSpace: "output",
    });
    Object.assign(internalState, {
      mesh: {},
      positions64Low: new Float32Array(3),
      reprojector: {},
    });
    const raiseError = vi.fn();
    Object.assign(layer as object, { raiseError });
    const bare = layer as unknown as {
      _generateMesh: () => void;
      renderLayers: () => unknown;
    };
    return { bare, raiseError };
  }

  it("draws nothing rather than the earlier mesh", () => {
    const { bare } = makeFailingLayer();
    bare._generateMesh();
    expect(bare.renderLayers()).toBeNull();
  });

  it("reports the error through deck.gl's raiseError", () => {
    const { bare, raiseError } = makeFailingLayer();
    bare._generateMesh();
    expect(raiseError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("_errorSpace"),
      }),
      "building the reprojection mesh",
    );
  });
});

describe("RasterLayer._wrapX", () => {
  const WORLD = 512;

  /**
   * Longitude/latitude to Web Mercator in deck.gl's common space, wrapping
   * longitude into [-180°, 180°] like proj4.
   */
  const lngLatToCommon = (lng: number, lat: number): [number, number] => {
    const wrapped = Math.abs(lng) <= 180 ? lng : lng - Math.sign(lng) * 360;
    const phi = (lat * Math.PI) / 180;
    return [
      ((wrapped + 180) / 360) * WORLD,
      (0.5 + Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * WORLD,
    ];
  };

  /** A 4x4 px longitude/latitude image from 204°W to 162°W, across -180°. */
  const CROSSING_FNS: ReprojectionFns = {
    forwardTransform: (px, py) => [-204 + (px / 4) * 42, 24 - (py / 4) * 42],
    inverseTransform: (x, y) => [((x + 204) / 42) * 4, ((24 - y) / 42) * 4],
    forwardReproject: lngLatToCommon,
    inverseReproject: identity,
  };

  function makeCrossingLayer(extra: Partial<RasterLayerProps> = {}) {
    return makeBareLayer({
      reprojectionFns: CROSSING_FNS,
      _errorSpace: "output",
      _wrapX: WORLD,
      ...extra,
    });
  }

  it("rebuilds the mesh when _wrapX changes", () => {
    const { layer } = makeBareLayer();
    const bare = layer as unknown as {
      props: RasterLayerProps;
      _generateMesh: () => void;
      updateState: (params: unknown) => void;
    };
    const generate = vi
      .spyOn(bare, "_generateMesh")
      .mockImplementation(() => {});
    bare.updateState({
      props: { ...bare.props, _wrapX: WORLD },
      oldProps: { ...bare.props, _wrapX: undefined },
      changeFlags: {},
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("draws an image across the antimeridian inside the world, at both edges", () => {
    const { layer, internalState } = makeCrossingLayer();
    (layer as unknown as { _generateMesh: () => void })._generateMesh();
    const high = (internalState.mesh as WrappedMesh).attributes.POSITION.value;
    const low = internalState.positions64Low as Float32Array;
    const xs: number[] = [];
    for (let i = 0; i < high.length; i += 3) {
      xs.push(high[i]! + low[i]!);
    }
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(WORLD);
    }
    // 24° of the image is west of 180°, 18° east of it.
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(WORLD, 6);
    // No triangle goes the long way around, across the rest of the world.
    const indices = (internalState.mesh as WrappedMesh).indices.value;
    for (let t = 0; t < indices.length; t += 3) {
      const span = [0, 1, 2].map((j) => xs[indices[t + j]!]!);
      expect(Math.max(...span) - Math.min(...span)).toBeLessThan(WORLD / 2);
    }
  });

  it("draws the debug overlay inside the world too", () => {
    const { layer } = makeCrossingLayer();
    const bare = layer as unknown as {
      _generateMesh: () => void;
      renderDebugLayer: () => {
        props: {
          data: { length: number };
          getPolygon: (
            object: unknown,
            info: { index: number; data: unknown },
          ) => [number, number][];
        };
      };
    };
    bare._generateMesh();
    const { data, getPolygon } = bare.renderDebugLayer().props;
    for (let index = 0; index < data.length; index++) {
      const xs = getPolygon(null, { index, data }).map(([x]) => x);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(WORLD);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(WORLD / 2);
    }
  });

  it("reports an error without output mode", () => {
    const { layer } = makeCrossingLayer({ _errorSpace: "input" });
    const raiseError = vi.fn();
    Object.assign(layer as object, { raiseError });
    (layer as unknown as { _generateMesh: () => void })._generateMesh();
    expect(raiseError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("_wrapX") }),
      "building the reprojection mesh",
    );
  });
});
