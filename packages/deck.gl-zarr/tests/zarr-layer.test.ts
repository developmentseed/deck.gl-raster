import { CompositeLayer } from "@deck.gl/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as zarr from "zarrita";
import { ZarrLayer } from "../src/zarr-layer.js";
import { ZarrSource } from "../src/zarr-source.js";
import { geoZarrStore } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Build a {@link ZarrLayer} ready for direct lifecycle calls: bypasses deck.gl's
 * `LayerManager` by replacing `state` and `setState` with a plain object +
 * assign, mirroring `makeBareLayer` in the deck.gl-raster tests.
 */
function makeBareLayer(props: Record<string, unknown> = {}): ZarrLayer {
  const layer = new ZarrLayer({
    id: "zarr",
    source: {},
    selection: {},
    ...props,
  } as never);
  const state: Record<string, unknown> = {};
  Object.assign(layer as object, {
    state,
    setState: (updates: Record<string, unknown>) =>
      Object.assign(state, updates),
  });
  return layer;
}

/**
 * Run `updateState` as deck.gl does when the layer is first added: the old
 * props are empty.
 */
function runInitialUpdate(layer: ZarrLayer): void {
  layer.updateState({
    props: layer.props,
    oldProps: {},
    changeFlags: { dataChanged: "init" },
  } as never);
}

/**
 * Render a new {@link ZarrLayer} with `props`, as apps do on every render:
 * deck.gl hands the new instance the old one's `state`, then runs
 * `updateState`.
 */
function rerender(layer: ZarrLayer, props: Record<string, unknown>): ZarrLayer {
  const next = new ZarrLayer({ id: "zarr", ...props } as never);
  Object.assign(next as object, {
    state: layer.state,
    setState: layer.setState,
  });
  next.updateState({
    props: next.props,
    oldProps: layer.props,
    changeFlags: {},
  } as never);
  return next;
}

/** Let every settled promise run its handlers. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A promise with its `resolve` exposed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** The opened group `name` of a {@link geoZarrStore}. */
async function openGroup(name: string) {
  const { store } = await geoZarrStore();
  return zarr.open(zarr.root(store).resolve(name), { kind: "group" });
}

/** `ZarrSource.open` itself, kept from before any test mocks it. */
const openSource = ZarrSource.open.bind(ZarrSource);

/** A {@link ZarrSource} of the GeoZarr example's group `name`. */
async function openFixture(name = "a") {
  return openSource(await openGroup(name));
}

/** Tile callbacks for the layer to wrap. */
const tileCallbacks = { getTileData: vi.fn(), renderTile: vi.fn() };

/** The tile callback the layer gives its inner TileLayer, if any. */
function tileCallback(layer: ZarrLayer): unknown {
  return (
    layer as unknown as { _getTileDataCallback(): unknown }
  )._getTileDataCallback();
}

/** The messages of the errors `onError` got. */
function errorMessages(onError: ReturnType<typeof vi.fn>): string[] {
  return onError.mock.calls.map(([error]) => (error as Error).message);
}

describe("ZarrLayer source", () => {
  it("draws an opened source without opening anything", async () => {
    const source = await openFixture();
    const open = vi.spyOn(ZarrSource, "open");
    const layer = makeBareLayer({ source });

    runInitialUpdate(layer);

    expect(open).not.toHaveBeenCalled();
    expect(layer.state.loadingMetadata).toBeUndefined();
    expect(layer.state.source).toBe(source);
  });

  it("passes its load signal to ZarrSource.open", async () => {
    const open = vi
      .spyOn(ZarrSource, "open")
      .mockReturnValue(new Promise(() => {}));
    const groups = [await openGroup("a"), await openGroup("b")];

    const layer = makeBareLayer({ source: groups[0] });
    runInitialUpdate(layer);
    rerender(layer, { source: groups[1], selection: {} });

    // The first open's signal aborts when the second starts
    expect(
      open.mock.calls.map(([input, options]) => [
        input,
        options?.signal?.aborted,
      ]),
    ).toEqual([
      [groups[0], true],
      [groups[1], false],
    ]);
  });

  it("keeps the new source when the old one finishes opening last", async () => {
    const oldSource = await openFixture("a");
    const newSource = await openFixture("b");
    const opens = [deferred<ZarrSource>(), deferred<ZarrSource>()];
    vi.spyOn(ZarrSource, "open")
      .mockReturnValueOnce(opens[0]!.promise as never)
      .mockReturnValueOnce(opens[1]!.promise as never);
    const onSourceLoad = vi.fn();

    const layer = makeBareLayer({ source: await openGroup("a"), onSourceLoad });
    runInitialUpdate(layer);
    const next = rerender(layer, {
      source: await openGroup("b"),
      selection: {},
      onSourceLoad,
    });
    opens[1]!.resolve(newSource);
    await flush();
    opens[0]!.resolve(oldSource);
    await flush();

    expect(next.state.source).toBe(newSource);
    expect(onSourceLoad.mock.calls).toEqual([[newSource]]);
  });

  it("raises a failed open through onError", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer({ onError });
    vi.spyOn(layer, "loadMetadata").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(errorMessages(onError)).toEqual([
      "Metadata loading failed in ZarrLayer: boom",
    ]);
  });
});

describe("ZarrLayer selection", () => {
  it("reports a selection that doesn't fit the source, and draws nothing", async () => {
    const source = await openFixture();
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer({
      source,
      selection: { time: 0 },
      onError,
      ...tileCallbacks,
    });

    runInitialUpdate(layer);

    expect(errorMessages(onError)).toEqual([
      expect.stringMatching(
        /^Can't draw the selection in ZarrLayer: ZarrLayer selection includes unknown dim "time"/,
      ),
    ]);
    expect(tileCallback(layer)).toBeUndefined();
  });

  it("draws again once the selection is fixed, without opening the source again", async () => {
    const source = await openFixture();
    const open = vi.spyOn(ZarrSource, "open");
    const props = { source, onError: () => true, ...tileCallbacks };
    const layer = makeBareLayer({ ...props, selection: { time: 0 } });
    runInitialUpdate(layer);

    const next = rerender(layer, { ...props, selection: {} });

    expect(tileCallback(next)).toBeTypeOf("function");
    expect(open).not.toHaveBeenCalled();
  });

  it("doesn't report an equal selection again on the next render", async () => {
    const source = await openFixture();
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer({ source, selection: { time: 0 }, onError });
    runInitialUpdate(layer);

    // A new object with the same contents, as an inline literal gives
    rerender(layer, { source, selection: { time: 0 }, onError });

    expect(onError).toHaveBeenCalledOnce();
  });

  it("checks the selection against a source opened from input", async () => {
    const onError = vi.fn((_error: Error) => true);
    const props = {
      source: await openGroup("a"),
      selection: { time: 0 },
      onError,
    };
    const layer = makeBareLayer(props);
    runInitialUpdate(layer);
    await vi.waitFor(() =>
      expect(layer.state.source).toBeInstanceOf(ZarrSource),
    );

    // deck.gl updates the layer after the open's `setState`, with the same
    // props
    rerender(layer, props);

    expect(errorMessages(onError)).toEqual([
      expect.stringMatching(/unknown dim "time"/),
    ]);
  });
});

describe("ZarrLayer.isLoaded", () => {
  beforeEach(() => {
    // Report every sublayer as loaded, so only metadata loading decides.
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(true);
  });

  it("is not loaded while the source is opening", () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "loadMetadata").mockReturnValue(new Promise(() => {}));

    runInitialUpdate(layer);

    expect(layer.isLoaded).toBe(false);
  });

  it("is loaded once the source has opened", async () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "loadMetadata").mockResolvedValue(undefined);

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is loaded after the source fails to open", async () => {
    const layer = makeBareLayer({ onError: () => true });
    vi.spyOn(layer, "loadMetadata").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is not loaded when the old source finishes opening first", async () => {
    let finishOld!: () => void;
    vi.spyOn(ZarrLayer.prototype, "loadMetadata")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockReturnValue(new Promise(() => {}));

    const layer = makeBareLayer();
    runInitialUpdate(layer);
    const next = rerender(layer, { source: {}, selection: {} });
    finishOld();
    await flush();

    expect(next.isLoaded).toBe(false);
  });
});
