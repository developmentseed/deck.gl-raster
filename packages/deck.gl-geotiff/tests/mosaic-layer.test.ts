import { LayerManager, WebMercatorViewport } from "@deck.gl/core";
import type { Device } from "@luma.gl/core";
import type Flatbush from "flatbush";
import { describe, expect, it } from "vitest";
import type { MosaicLayerProps } from "../src/mosaic-layer/mosaic-layer.js";
import { MosaicLayer } from "../src/mosaic-layer/mosaic-layer.js";
import type { MosaicSource } from "../src/mosaic-layer/mosaic-tileset-2d.js";

type Item = MosaicSource & { id: string };
const A: Item = { id: "A", bbox: [0, 0, 10, 10] };
const B: Item = { id: "B", bbox: [20, 0, 30, 10] };
const C: Item = { id: "C", bbox: [40, 0, 50, 10] };
const P: Item = { id: "P", bbox: [5, -10, 15, 0] };
const Q: Item = { id: "Q", bbox: [30, -10, 40, 0] };

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

// A viewport that shows A, B, C, P and Q.
const VIEWPORT = new WebMercatorViewport({
  width: 512,
  height: 512,
  longitude: 25,
  latitude: 0,
  zoom: 3,
});

/**
 * Let started fetches finish, then run the layer updates they request, as
 * deck.gl's render loop would.
 */
async function settle(layerManager: LayerManager): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    layerManager.updateLayers();
  }
}

/**
 * Render {@link MosaicLayer} through deck.gl's `LayerManager`. Each call of the
 * returned function renders a new layer instance, as apps do on every render,
 * and returns the sources that update fetched, the sources `onViewportLoad`
 * last reported, and the errors deck.gl raised.
 */
function makeMosaicRenderer() {
  // deck.gl ignores errors thrown in `updateState` when there is no device.
  // `renderSource` returns no layers, so nothing draws with this stub.
  const device = {} as Device;
  const layerManager = new LayerManager(device, { viewport: VIEWPORT });
  let errors: string[] = [];
  layerManager.setProps({
    onError: (error: Error) => {
      errors.push(error.message);
    },
  });

  return async (sources: Item[]) => {
    errors = [];
    const fetched: string[] = [];
    const viewportLoads: string[][] = [];
    layerManager.setLayers([
      new MosaicLayer<Item>({
        id: "mosaic",
        sources,
        getSource: async (source) => {
          fetched.push(source.id);
        },
        renderSource: () => null,
        onViewportLoad: (entries) => {
          viewportLoads.push(entries.map(({ source }) => source.id).sort());
        },
      }),
    ]);
    await settle(layerManager);
    return { fetched: fetched.sort(), loaded: viewportLoads.at(-1), errors };
  };
}

// The tests above reuse one layer instance. Apps create a new MosaicLayer on
// every render instead, and deck.gl hands each new instance the old one's
// `state`, not its `props`.
describe("MosaicLayer sources across layer instances", () => {
  it("loads sources added after the first render", async () => {
    const render = makeMosaicRenderer();
    await render([A]);

    const { fetched, loaded, errors } = await render([A, B, C]);
    expect(errors).toEqual([]);
    expect(fetched).toEqual(["B", "C"]);
    expect(loaded).toEqual(["A", "B", "C"]);
  });

  it("drops sources removed after the first render", async () => {
    const render = makeMosaicRenderer();
    await render([A, B, C]);

    const { loaded, errors } = await render([C]);
    expect(errors).toEqual([]);
    expect(loaded).toEqual(["C"]);
  });

  it("loads the new sources when every source is replaced", async () => {
    const render = makeMosaicRenderer();
    await render([A, B]);

    const { fetched, loaded, errors } = await render([P, Q]);
    expect(errors).toEqual([]);
    expect(fetched).toEqual(["P", "Q"]);
    expect(loaded).toEqual(["P", "Q"]);
  });
});
