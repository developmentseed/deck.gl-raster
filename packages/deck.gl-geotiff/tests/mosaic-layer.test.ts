import type { Layer } from "@deck.gl/core";
import {
  CompositeLayer,
  LayerManager,
  WebMercatorViewport,
} from "@deck.gl/core";
import type { Device } from "@luma.gl/core";
import { describe, expect, it } from "vitest";
import type { MosaicLayerProps } from "../src/mosaic-layer/mosaic-layer.js";
import { MosaicLayer } from "../src/mosaic-layer/mosaic-layer.js";
import type {
  ItemIndex,
  MosaicItem,
} from "../src/mosaic-layer/mosaic-tileset-2d.js";

type Item = MosaicItem & { id: string };
const A: Item = { id: "A", bbox: [0, 0, 10, 10] };
const B: Item = { id: "B", bbox: [20, 0, 30, 10] };
const C: Item = { id: "C", bbox: [40, 0, 50, 10] };
const P: Item = { id: "P", bbox: [5, -10, 15, 0] };
const Q: Item = { id: "Q", bbox: [30, -10, 40, 0] };
// Out of the default view
const F: Item = { id: "F", bbox: [100, 0, 110, 10] };

type LayerState = { index: ItemIndex | null };

type LayerInternals = {
  updateState: (params: {
    props: MosaicLayerProps<Item>;
    oldProps: Partial<MosaicLayerProps<Item>>;
    context: unknown;
    changeFlags: { dataChanged?: string | boolean };
    oldContext?: unknown;
  }) => void;
};

/**
 * Build a {@link MosaicLayer} ready for direct lifecycle invocation: bypasses
 * deck.gl's `LayerManager` by replacing `state` and `setState` with a plain
 * object + assign, mirroring the `makeBareLayer` pattern in
 * `packages/deck.gl-raster/tests/raster-layer.test.ts`.
 */
function makeBareLayer(items: Item[]) {
  const layer = new MosaicLayer<Item>({
    id: "test",
    data: items,
    renderSource: () => null,
  });
  const state: LayerState = { index: null };
  Object.assign(layer as object, { state });
  Object.assign(layer as object, {
    setState: (updates: Partial<LayerState>) => Object.assign(state, updates),
  });
  const internals = layer as unknown as LayerInternals;
  // deck.gl's first update, with the `dataChanged` flag it sets
  internals.updateState({
    props: layer.props,
    oldProps: {},
    changeFlags: { dataChanged: "init" },
    context: {},
    oldContext: {},
  });
  return { layer, state, internals };
}

/** Pass new `data`, and run the update deck.gl would run for it. */
function setData(
  layer: MosaicLayer<Item>,
  internals: LayerInternals,
  items: Item[],
) {
  const oldProps = layer.props;
  const props = { ...oldProps, data: items };
  Object.assign(layer as object, { props });
  internals.updateState({
    props,
    oldProps,
    changeFlags: { dataChanged: true },
    context: {},
    oldContext: {},
  });
}

describe("MosaicLayer spatial index lifecycle", () => {
  it("builds the index from the initial data on the first update", () => {
    const { state } = makeBareLayer([A, B]);
    expect(state.index).not.toBeNull();
    expect(state.index?.boxes.numItems).toBe(2);
  });

  it("leaves the index null when data starts empty", () => {
    const { state } = makeBareLayer([]);
    expect(state.index).toBeNull();
  });

  it("rebuilds the index when data changes", () => {
    const { layer, state, internals } = makeBareLayer([A, B]);
    const initialIndex = state.index;

    setData(layer, internals, [A, B, C]);

    expect(state.index).not.toBe(initialIndex);
    expect(state.index?.boxes.numItems).toBe(3);
  });

  it("does not rebuild when deck.gl reports no data change", () => {
    const { layer, state, internals } = makeBareLayer([A, B]);
    const initialIndex = state.index;

    internals.updateState({
      props: layer.props,
      oldProps: layer.props,
      changeFlags: {},
      context: {},
      oldContext: {},
    });
    expect(state.index).toBe(initialIndex);
  });

  it("clears the index when data becomes empty", () => {
    const { layer, state, internals } = makeBareLayer([A, B]);
    expect(state.index).not.toBeNull();

    setData(layer, internals, []);
    expect(state.index).toBeNull();
  });

  it("rebuilds the index when going from empty to non-empty", () => {
    const { layer, state, internals } = makeBareLayer([]);
    expect(state.index).toBeNull();

    setData(layer, internals, [A, B]);
    expect(state.index?.boxes.numItems).toBe(2);
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
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    layerManager.updateLayers();
  }
}

/** The source `getSource` opens for an item in these tests. */
type Marker = { of: string };

/** What one render of {@link makeMosaicRenderer} saw, as it happens. */
function newRecords() {
  return {
    fetched: [] as string[],
    priorities: {} as Record<string, number>,
    rendered: {} as Record<string, Marker | undefined>,
    loadedSources: {} as Record<string, Marker | undefined>,
    unloaded: {} as Record<string, Marker | undefined>,
    viewportLoad: undefined as [string, string | undefined][] | undefined,
    errors: [] as string[],
  };
}

/**
 * Render {@link MosaicLayer} through deck.gl's `LayerManager`.
 *
 * Each call of `render` renders a new layer instance with the given props, as
 * apps do on every render. It reports what happened since that render began:
 * - the items fetched, and the priority each fetch got;
 * - the source that `renderSource`, `onSourceLoad` and `onSourceUnload` got
 *   for each item;
 * - the items, and their sources, that `onViewportLoad` last reported;
 * - the errors deck.gl raised.
 *
 * `getSource` opens `{ of: item.id }` for each item. `wait` lets pending loads
 * finish without rendering, and reports the same way. `moveTo` moves the view
 * without rendering, as panning does.
 */
function makeMosaicRenderer(viewport: WebMercatorViewport = VIEWPORT) {
  // deck.gl ignores errors thrown in `updateState` when there is no device.
  // `renderSource` returns no layers, so nothing draws with this stub.
  const device = {} as Device;
  const layerManager = new LayerManager(device, { viewport });
  let records = newRecords();
  layerManager.setProps({
    onError: (error: Error) => {
      records.errors.push(error.message);
    },
  });

  const report = () => ({
    fetched: [...records.fetched].sort(),
    priorities: records.priorities,
    rendered: records.rendered,
    loadedSources: records.loadedSources,
    unloaded: records.unloaded,
    loaded: records.viewportLoad?.map(([id]) => id),
    viewportSources: records.viewportLoad,
    layers: layerManager.getLayers(),
    errors: records.errors,
  });

  const render = async (props: Partial<MosaicLayerProps<Item, Marker>>) => {
    records = newRecords();
    const current = records;
    layerManager.setLayers([
      new MosaicLayer<Item, Marker>({
        id: "mosaic",
        getSource: async (item, { getPriority }) => {
          current.fetched.push(item.id);
          current.priorities[item.id] = getPriority?.() as number;
          return { of: item.id };
        },
        renderSource: (item, { source }) => {
          current.rendered[item.id] = source;
          return null;
        },
        onSourceLoad: (item, { source }) => {
          current.loadedSources[item.id] = source;
        },
        onSourceUnload: (item, { source }) => {
          current.unloaded[item.id] = source;
        },
        onViewportLoad: (entries) => {
          current.viewportLoad = entries
            .map(({ item, source }): [string, string | undefined] => [
              item.id,
              source?.of,
            ])
            .sort();
        },
        ...props,
      }),
    ]);
    await settle(layerManager);
    return report();
  };

  const wait = async () => {
    await settle(layerManager);
    return report();
  };

  const moveTo = (next: WebMercatorViewport) => {
    layerManager.activateViewport(next);
  };

  /** Remove the layer, as an app does by no longer rendering it. */
  const remove = async () => {
    layerManager.setLayers([]);
    await settle(layerManager);
    return report();
  };

  return { render, wait, moveTo, remove };
}

// The tests above reuse one layer instance. Apps create a new MosaicLayer on
// every render instead, and deck.gl hands each new instance the old one's
// `state`, not its `props`.
describe("MosaicLayer items across layer instances", () => {
  it("loads items added after the first render", async () => {
    const { render } = makeMosaicRenderer();
    await render({ data: [A] });

    const { fetched, loaded, errors } = await render({ data: [A, B, C] });
    expect(errors).toEqual([]);
    expect(fetched).toEqual(["B", "C"]);
    expect(loaded).toEqual(["A", "B", "C"]);
  });

  it("loads items passed after an empty first render", async () => {
    const { render } = makeMosaicRenderer();
    await render({ data: [] });

    const { fetched, loaded, errors } = await render({ data: [A, B] });
    expect(errors).toEqual([]);
    expect(fetched).toEqual(["A", "B"]);
    expect(loaded).toEqual(["A", "B"]);
  });

  it("drops items removed after the first render", async () => {
    const { render } = makeMosaicRenderer();
    await render({ data: [A, B, C] });

    const { loaded, errors } = await render({ data: [C] });
    expect(errors).toEqual([]);
    expect(loaded).toEqual(["C"]);
  });

  it("loads the new items when every item is replaced", async () => {
    const { render } = makeMosaicRenderer();
    await render({ data: [A, B] });

    const { fetched, loaded, errors } = await render({ data: [P, Q] });
    expect(errors).toEqual([]);
    expect(fetched).toEqual(["P", "Q"]);
    expect(loaded).toEqual(["P", "Q"]);
  });
});

describe("MosaicLayer data", () => {
  it("loads items from a promise", async () => {
    const { render } = makeMosaicRenderer();

    const { fetched, loaded, errors } = await render({
      data: Promise.resolve([A, B]),
    });
    expect(errors).toEqual([]);
    expect(fetched).toEqual(["A", "B"]);
    expect(loaded).toEqual(["A", "B"]);
  });

  it("loads items from a URL with dataTransform", async () => {
    const { render } = makeMosaicRenderer();

    const { fetched, errors } = await render({
      data: "https://example.com/items.json",
      // Stands in for the network: deck.gl loads a URL in `data` with `fetch`
      fetch: async () => ({ features: [A, B] }),
      dataTransform: ((response: { features: Item[] }) =>
        response.features) as MosaicLayerProps<Item>["dataTransform"],
    });
    expect(errors).toEqual([]);
    expect(fetched).toEqual(["A", "B"]);
  });

  it("keeps newer data when an older promise resolves late", async () => {
    const { render, wait } = makeMosaicRenderer();
    let resolveOlder!: (items: Item[]) => void;
    const older = new Promise<Item[]>((resolve) => {
      resolveOlder = resolve;
    });

    const newer = [C];

    await render({ data: older });
    const { loaded } = await render({ data: newer });
    expect(loaded).toEqual(["C"]);

    // The older promise lands, then the app renders the same newer data
    // again, as React apps do
    resolveOlder([A, B]);
    await wait();
    const { fetched, errors } = await render({ data: newer });
    expect(errors).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("updates for a new array, not an in-place mutation", async () => {
    const { render } = makeMosaicRenderer();
    const items = [A];
    await render({ data: items });

    // Documented limitation: deck.gl compares `data` by reference
    items.push(B);
    const mutated = await render({ data: items });
    expect(mutated.errors).toEqual([]);
    expect(mutated.fetched).toEqual([]);

    const replaced = await render({ data: [...items] });
    expect(replaced.errors).toEqual([]);
    expect(replaced.fetched).toEqual(["B"]);
  });

  it("draws nothing for null data", async () => {
    const { render } = makeMosaicRenderer();

    const { fetched, errors } = await render({
      data: null as unknown as Item[],
    });
    expect(errors).toEqual([]);
    expect(fetched).toEqual([]);
  });
});

describe("MosaicLayer sources", () => {
  it("passes each item's opened source to renderSource and onSourceLoad", async () => {
    const { render } = makeMosaicRenderer();

    const { rendered, loadedSources, errors } = await render({
      data: [A, B],
    });
    expect(errors).toEqual([]);
    expect(rendered).toEqual({ A: { of: "A" }, B: { of: "B" } });
    expect(loadedSources).toEqual({ A: { of: "A" }, B: { of: "B" } });
  });

  it("reports each item with its source to onViewportLoad", async () => {
    const { render } = makeMosaicRenderer();

    const { viewportSources, errors } = await render({ data: [A, B] });
    expect(errors).toEqual([]);
    expect(viewportSources).toEqual([
      ["A", "A"],
      ["B", "B"],
    ]);
  });

  it("gives renderSource only the source of an item whose aborted open finished anyway", async () => {
    const { render, moveTo } = makeMosaicRenderer();
    const finish: Record<string, () => void> = {};
    const seen: Record<string, object> = {};
    const props = {
      data: [A, F],
      maxRequests: 1,
      // Ignores the abort, as a source cache shared between loads can
      getSource: (item: Item) =>
        new Promise<Marker>((resolve) => {
          finish[item.id] = () => resolve({ of: item.id });
        }),
      renderSource: (item: Item, options: object) => {
        seen[item.id] = options;
        return null;
      },
    };
    await render(props);

    // A leaves view while F starts. With more opens in flight than
    // `maxRequests`, deck.gl aborts A's, which finishes anyway.
    moveTo(
      new WebMercatorViewport({
        width: 512,
        height: 512,
        longitude: 105,
        latitude: 5,
        zoom: 3,
      }),
    );
    await render(props);
    finish.A!();
    await render(props);
    // A comes back into view
    moveTo(VIEWPORT);
    const { errors } = await render(props);

    expect(errors).toEqual([]);
    const { signal } = seen.A as { signal?: AbortSignal };
    expect(signal?.aborted).not.toBe(true);
    expect(seen.A).toEqual({ source: { of: "A" } });
  });

  it("passes an evicted item's source to onSourceUnload", async () => {
    const { render, moveTo } = makeMosaicRenderer();
    const data = [A, B, F];
    await render({ data, maxCacheSize: 0 });

    // A and B leave view, and loading F evicts them
    moveTo(
      new WebMercatorViewport({
        width: 512,
        height: 512,
        longitude: 105,
        latitude: 5,
        zoom: 4,
      }),
    );
    const { unloaded, errors } = await render({ data, maxCacheSize: 0 });
    expect(errors).toEqual([]);
    expect(unloaded).toEqual({ A: { of: "A" }, B: { of: "B" } });
  });

  it("passes every cached item's source to onSourceUnload when the layer is removed", async () => {
    const { render, remove } = makeMosaicRenderer();
    await render({ data: [A, B] });

    const { unloaded, errors } = await remove();
    expect(errors).toEqual([]);
    expect(unloaded).toEqual({ A: { of: "A" }, B: { of: "B" } });
  });

  it("passes the source of an item still opening at removal to onSourceUnload once it arrives", async () => {
    const { render, remove, wait } = makeMosaicRenderer();
    let finish!: () => void;
    await render({
      data: [A],
      // Ignores the abort, as a source cache shared between loads can
      getSource: (item) =>
        new Promise((resolve) => {
          finish = () => resolve({ of: item.id });
        }),
    });

    // A copy: the report's records keep filling in
    const atRemoval = { ...(await remove()).unloaded };
    finish();
    const { unloaded, errors } = await wait();
    expect(errors).toEqual([]);
    expect(atRemoval).toEqual({});
    expect(unloaded).toEqual({ A: { of: "A" } });
  });
});

describe("MosaicLayer fetch priority", () => {
  it("measures longitude the short way around the antimeridian", async () => {
    // Centered just west of the antimeridian. `east` is 1.6° away across it,
    // and `west` is 9.4° away on the same side.
    const east: Item = { id: "east", bbox: [-179, -20, -178, -17] };
    const west: Item = { id: "west", bbox: [170, -20, 171, -17] };
    const { render } = makeMosaicRenderer(
      new WebMercatorViewport({
        width: 800,
        height: 600,
        longitude: 179.9,
        latitude: -18.5,
        zoom: 4,
        repeat: true,
      }),
    );

    const { priorities, errors } = await render({ data: [east, west] });
    expect(errors).toEqual([]);
    expect(priorities.east).toBeCloseTo(1.6);
    expect(priorities.west).toBeCloseTo(9.4);
  });

  it("centers a bbox across the antimeridian on it", async () => {
    // Written with minX > maxX, so its center is at 180°, 0.1° from the
    // viewport's center.
    const across: Item = { id: "across", bbox: [179, -20, -179, -17] };
    const { render } = makeMosaicRenderer(
      new WebMercatorViewport({
        width: 800,
        height: 600,
        longitude: 179.9,
        latitude: -18.5,
        zoom: 4,
        repeat: true,
      }),
    );

    const { priorities, errors } = await render({ data: [across] });
    expect(errors).toEqual([]);
    expect(priorities.across).toBeCloseTo(0.1);
  });
});

/** Stands in for a layer that an item renders. It draws nothing. */
class ItemLayer extends CompositeLayer {
  static override layerName = "ItemLayer";

  override renderLayers() {
    return null;
  }
}

/** The `opacity` of the rendered layer with this `id`. */
function opacityOf(layers: Layer[], id: string): number | undefined {
  return layers.find((layer) => layer.id === id)?.props.opacity;
}

describe("MosaicLayer inherited props", () => {
  const renderSource = (item: Item) => new ItemLayer({ id: item.id });

  it("hands its opacity to the layers its items render", async () => {
    const { render } = makeMosaicRenderer();

    const { layers, errors } = await render({
      data: [A],
      opacity: 0.5,
      renderSource,
    });
    expect(errors).toEqual([]);
    expect(opacityOf(layers, "A")).toBe(0.5);
  });

  it("keeps the opacity an item's layer sets itself", async () => {
    const { render } = makeMosaicRenderer();

    const { layers, errors } = await render({
      data: [A],
      opacity: 0.5,
      renderSource: (item) => new ItemLayer({ id: item.id, opacity: 0.25 }),
    });
    expect(errors).toEqual([]);
    expect(opacityOf(layers, "A")).toBe(0.25);
  });

  it("hands a new opacity to items already loaded, without opening them again", async () => {
    const { render } = makeMosaicRenderer();
    await render({ data: [A], opacity: 0.5, renderSource });

    const { fetched, layers, errors } = await render({
      data: [A],
      opacity: 0.8,
      renderSource,
    });
    expect(errors).toEqual([]);
    expect(fetched).toEqual([]);
    expect(opacityOf(layers, "A")).toBe(0.8);
  });

  it("hands its opacity to each layer in nested arrays an item returns", async () => {
    const { render } = makeMosaicRenderer();

    const { layers, errors } = await render({
      data: [A],
      opacity: 0.5,
      renderSource: (item) => [
        [new ItemLayer({ id: `${item.id}-1` }), null],
        false,
        new ItemLayer({ id: `${item.id}-2` }),
      ],
    });
    expect(errors).toEqual([]);
    expect(opacityOf(layers, "A-1")).toBe(0.5);
    expect(opacityOf(layers, "A-2")).toBe(0.5);
  });

  it("doesn't open its sources again through deck.gl's reload when updateTriggers.all changes", async () => {
    const { render } = makeMosaicRenderer();
    const data = [A, B];
    await render({ data, updateTriggers: { all: [0] } });

    const { fetched, errors } = await render({
      data,
      updateTriggers: { all: [1] },
    });
    expect(errors).toEqual([]);
    expect(fetched).toEqual([]);
  });
});
