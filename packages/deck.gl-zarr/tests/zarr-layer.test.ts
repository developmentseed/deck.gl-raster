import { readFile } from "node:fs/promises";
import { CompositeLayer } from "@deck.gl/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as zarr from "zarrita";
import type { ParsedZarr } from "../src/zarr-layer.js";
import { ZarrLayer } from "../src/zarr-layer.js";

/**
 * The newest instance of each bare layer, keyed by the `state` object that all
 * its instances share. deck.gl keeps this pointer in its internal layer state
 * and returns it from `getCurrentLayer()`.
 */
const currentLayers = new WeakMap<object, { layer: ZarrLayer }>();

/**
 * Build a {@link ZarrLayer} ready for direct lifecycle calls: bypasses deck.gl's
 * `LayerManager` by replacing `state` and `setState` with a plain object +
 * assign, and stubs `getCurrentLayer` to return the newest instance, mirroring
 * `makeBareLayer` in the deck.gl-raster tests.
 */
function makeBareLayer(props: Record<string, unknown> = {}): ZarrLayer {
  const layer = new ZarrLayer({ id: "zarr", node: {}, ...props } as never);
  const state: Record<string, unknown> = {};
  const current = { layer };
  currentLayers.set(state, current);
  Object.assign(layer as object, {
    state,
    setState: (updates: Record<string, unknown>) =>
      Object.assign(state, updates),
    getCurrentLayer: () => current.layer,
  });
  return layer;
}

/** Run `updateState` as deck.gl does when the layer is first added. */
function runInitialUpdate(layer: ZarrLayer): void {
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: { dataChanged: true },
  } as never);
}

/**
 * Render a new {@link ZarrLayer} with `props`, as apps do on every render:
 * deck.gl hands the new instance the old one's `state`, makes it the current
 * layer, then runs `updateState`.
 */
function rerender(layer: ZarrLayer, props: Record<string, unknown>): ZarrLayer {
  const next = new ZarrLayer({ id: "zarr", ...props } as never);
  Object.assign(next as object, {
    state: layer.state,
    setState: layer.setState,
    getCurrentLayer: layer.getCurrentLayer,
  });
  currentLayers.get(layer.state)!.layer = next;
  next.updateState({
    props: next.props,
    oldProps: layer.props,
    changeFlags: {},
  } as never);
  return next;
}

/** Let every settled promise run its handlers. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A store holding only a group `a`, with the attributes of the GeoZarr
 * multiscales example. It records each read's key and abort signal. Its
 * arrays are missing, so opening it fails after reading them.
 */
async function recordingStore() {
  const example = JSON.parse(
    await readFile(
      new URL(
        "../../geozarr/geo-proj/examples/multiscales.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const groupJson = new TextEncoder().encode(
    JSON.stringify({
      zarr_format: 3,
      node_type: "group",
      attributes: example.attributes,
    }),
  );
  const reads: { key: string; signal?: AbortSignal }[] = [];
  const store = {
    async get(key: string, options?: { signal?: AbortSignal }) {
      reads.push({ key, signal: options?.signal });
      return key === "/a/zarr.json" ? groupJson : undefined;
    },
  };
  return { store, reads };
}

describe("ZarrLayer.updateState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("raises a metadata load failure through onError", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer({ onError });
    vi.spyOn(layer, "_parseZarr").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0]?.[0]?.message).toBe(
      "loading Zarr metadata: boom",
    );
  });

  it("keeps the new Zarr when the old one finishes loading last", async () => {
    const oldDescriptor = {};
    const newDescriptor = {};
    let finishOld!: () => void;
    let finishNew!: () => void;
    vi.spyOn(ZarrLayer.prototype, "_parseZarr")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = () =>
            resolve({ tilesetDescriptor: oldDescriptor } as ParsedZarr);
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishNew = () =>
            resolve({ tilesetDescriptor: newDescriptor } as ParsedZarr);
        }),
      );

    const layer = makeBareLayer();
    runInitialUpdate(layer);
    const next = rerender(layer, { node: {} });
    finishNew();
    await flush();
    finishOld();
    await flush();

    expect(next.state.tilesetDescriptor).toBe(newDescriptor);
  });

  it("aborts a replaced load's Zarr reads", async () => {
    // `_parseZarr` stores debug handles on `window`, which Node doesn't define
    vi.stubGlobal("window", {});
    const { store, reads } = await recordingStore();
    const props = { node: zarr.root(store), onError: () => true };
    const layer = makeBareLayer({ ...props, variable: "a" });
    runInitialUpdate(layer);
    // Wait for the reads of the group and of its first level's array.
    await vi.waitFor(() =>
      expect(reads.map((read) => read.key)).toContain("/a/r10m/zarr.json"),
    );
    const firstReads = [...reads];
    const signal = firstReads[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(firstReads.every((read) => read.signal === signal)).toBe(true);

    rerender(layer, { ...props, variable: "b" });

    expect(signal!.aborted).toBe(true);
  });
});

describe("ZarrLayer.isLoaded", () => {
  beforeEach(() => {
    // Report every sublayer as loaded, so only metadata loading decides.
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is not loaded while the Zarr metadata is loading", () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "_parseZarr").mockReturnValue(new Promise(() => {}));

    runInitialUpdate(layer);

    expect(layer.isLoaded).toBe(false);
  });

  it("is loaded once the Zarr metadata has loaded", async () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "_parseZarr").mockResolvedValue({} as ParsedZarr);

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is loaded after the Zarr metadata fails to load", async () => {
    const layer = makeBareLayer({ onError: () => true });
    vi.spyOn(layer, "_parseZarr").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is not loaded when the old Zarr finishes loading first", async () => {
    let finishOld!: () => void;
    vi.spyOn(ZarrLayer.prototype, "_parseZarr")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = () => resolve({} as ParsedZarr);
        }),
      )
      .mockReturnValue(new Promise(() => {}));

    const layer = makeBareLayer();
    runInitialUpdate(layer);
    const next = rerender(layer, { node: {} });
    finishOld();
    await flush();

    expect(next.isLoaded).toBe(false);
  });
});
