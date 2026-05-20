import type Flatbush from "flatbush";
import { describe, expect, it } from "vitest";
import type { MosaicLayerProps } from "../src/mosaic-layer/mosaic-layer.js";
import { MosaicLayer } from "../src/mosaic-layer/mosaic-layer.js";
import type { MosaicSource } from "../src/mosaic-layer/mosaic-tileset-2d.js";

type Item = MosaicSource & { id: string };
const A: Item = { id: "A", bbox: [0, 0, 10, 10] };
const B: Item = { id: "B", bbox: [20, 0, 30, 10] };
const C: Item = { id: "C", bbox: [40, 0, 50, 10] };

type LayerState = { index: Flatbush | null };

type LayerInternals = {
  initializeState: () => void;
  updateState: (params: {
    props: MosaicLayerProps<Item>;
    oldProps: MosaicLayerProps<Item>;
    context: unknown;
    changeFlags: unknown;
    oldContext?: unknown;
  }) => void;
};

/**
 * Build a {@link MosaicLayer} ready for direct lifecycle invocation: bypasses
 * deck.gl's `LayerManager` by replacing `state` and `setState` with a plain
 * object + assign, mirroring the `makeBareLayer` pattern in
 * `packages/deck.gl-raster/tests/raster-layer.test.ts`.
 */
function makeBareLayer(sources: Item[]) {
  const layer = new MosaicLayer<Item>({
    id: "test",
    sources,
    renderSource: () => null,
  });
  const state: LayerState = { index: null };
  Object.assign(layer as object, { state });
  Object.assign(layer as object, {
    setState: (updates: Partial<LayerState>) => Object.assign(state, updates),
  });
  return { layer, state, internals: layer as unknown as LayerInternals };
}

function setSources(layer: MosaicLayer<Item>, sources: Item[]) {
  const oldProps = layer.props;
  const newProps = { ...oldProps, sources };
  Object.assign(layer as object, { props: newProps });
  return { oldProps, newProps };
}

const NOOP_PARAMS = {
  context: {},
  changeFlags: {},
  oldContext: {},
} as const;

describe("MosaicLayer spatial index lifecycle", () => {
  it("builds the index from initial sources on initializeState", () => {
    const { state, internals } = makeBareLayer([A, B]);
    internals.initializeState();
    expect(state.index).not.toBeNull();
    expect(state.index?.numItems).toBe(2);
  });

  it("leaves the index null when sources start empty", () => {
    const { state, internals } = makeBareLayer([]);
    internals.initializeState();
    expect(state.index).toBeNull();
  });

  it("rebuilds the index when the sources reference changes", () => {
    const { layer, state, internals } = makeBareLayer([A, B]);
    internals.initializeState();
    const initialIndex = state.index;

    const { oldProps, newProps } = setSources(layer, [A, B, C]);
    internals.updateState({ props: newProps, oldProps, ...NOOP_PARAMS });

    expect(state.index).not.toBe(initialIndex);
    expect(state.index?.numItems).toBe(3);
  });

  it("does not rebuild when the sources reference is unchanged", () => {
    const stable = [A, B];
    const { layer, state, internals } = makeBareLayer(stable);
    internals.initializeState();
    const initialIndex = state.index;

    internals.updateState({
      props: layer.props,
      oldProps: layer.props,
      ...NOOP_PARAMS,
    });
    expect(state.index).toBe(initialIndex);
  });

  it("ignores in-place mutations of the sources array", () => {
    const stable = [A, B];
    const { layer, state, internals } = makeBareLayer(stable);
    internals.initializeState();
    const initialIndex = state.index;

    // Documented limitation: mutating `sources` does not trigger a rebuild
    // because reference equality is unchanged.
    stable.push(C);
    internals.updateState({
      props: layer.props,
      oldProps: layer.props,
      ...NOOP_PARAMS,
    });

    expect(state.index).toBe(initialIndex);
    expect(state.index?.numItems).toBe(2);
  });

  it("clears the index when sources become empty", () => {
    const { layer, state, internals } = makeBareLayer([A, B]);
    internals.initializeState();
    expect(state.index).not.toBeNull();

    const { oldProps, newProps } = setSources(layer, []);
    internals.updateState({ props: newProps, oldProps, ...NOOP_PARAMS });
    expect(state.index).toBeNull();
  });

  it("rebuilds the index when going from empty to non-empty", () => {
    const { layer, state, internals } = makeBareLayer([]);
    internals.initializeState();
    expect(state.index).toBeNull();

    const { oldProps, newProps } = setSources(layer, [A, B]);
    internals.updateState({ props: newProps, oldProps, ...NOOP_PARAMS });
    expect(state.index?.numItems).toBe(2);
  });
});
