import { readFile } from "node:fs/promises";
import { CompositeLayer } from "@deck.gl/core";
import { epsgResolver } from "@developmentseed/proj";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as zarr from "zarrita";
import { ZarrLayer } from "../src/zarr-layer.js";

/**
 * Build a {@link ZarrLayer} ready for direct lifecycle calls: bypasses deck.gl's
 * `LayerManager` by replacing `state` and `setState` with a plain object +
 * assign, mirroring `makeBareLayer` in the deck.gl-raster tests.
 */
function makeBareLayer(props: Record<string, unknown> = {}): ZarrLayer {
  const layer = new ZarrLayer({ id: "zarr", node: {}, ...props } as never);
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

/**
 * A store with groups `a` and `b`, each holding the GeoZarr multiscales
 * example: the example's attributes, and an empty array for each level. It
 * records each read's key and abort signal.
 */
async function geoZarrStore() {
  const { attributes } = JSON.parse(
    await readFile(
      new URL(
        "../../geozarr/geo-proj/examples/multiscales.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const encode = (json: unknown) =>
    new TextEncoder().encode(JSON.stringify(json));
  const blobs = new Map<string, Uint8Array>();
  for (const group of ["a", "b"]) {
    blobs.set(
      `/${group}/zarr.json`,
      encode({ zarr_format: 3, node_type: "group", attributes }),
    );
    for (const level of attributes.multiscales.layout) {
      blobs.set(
        `/${group}/${level.asset}/zarr.json`,
        encode({
          zarr_format: 3,
          node_type: "array",
          shape: level["spatial:shape"],
          data_type: "uint16",
          chunk_grid: {
            name: "regular",
            configuration: { chunk_shape: [256, 256] },
          },
          chunk_key_encoding: {
            name: "default",
            configuration: { separator: "/" },
          },
          codecs: [{ name: "bytes", configuration: { endian: "little" } }],
          fill_value: 0,
          dimension_names: attributes["spatial:dimensions"],
          attributes: {},
        }),
      );
    }
  }
  const reads: { key: string; signal?: AbortSignal }[] = [];
  const store = {
    async get(key: string, options?: { signal?: AbortSignal }) {
      reads.push({ key, signal: options?.signal });
      return blobs.get(key);
    },
  };
  return { store, reads };
}

/**
 * An `epsgResolver` that holds each lookup until the test releases it. The
 * lookup is a load's last `await`, so a held load has finished its reads.
 */
function heldResolver() {
  const releases: (() => void)[] = [];
  const resolver = (epsg: number) =>
    new Promise((resolve) => {
      releases.push(() => resolve(epsgResolver(epsg)));
    });
  return { resolver, releases };
}

describe("ZarrLayer.updateState", () => {
  beforeEach(() => {
    // `loadMetadata` stores debug handles on `window`, which Node lacks
    vi.stubGlobal("window", {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("raises a metadata load failure through onError", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer({ onError });
    vi.spyOn(layer, "loadMetadata").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0]?.[0]?.message).toBe(
      "Metadata loading failed in ZarrLayer: boom",
    );
  });

  it("keeps the new Zarr when the old one finishes loading last", async () => {
    const { store } = await geoZarrStore();
    const { resolver, releases } = heldResolver();
    const props = {
      node: zarr.root(store),
      selection: {},
      epsgResolver: resolver,
    };
    const layer = makeBareLayer({ ...props, variable: "a" });
    runInitialUpdate(layer);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const next = rerender(layer, { ...props, variable: "b" });
    await vi.waitFor(() => expect(releases).toHaveLength(2));

    releases[1]!();
    await vi.waitFor(() =>
      expect(next.state.arrays?.[0]?.path).toBe("/b/r10m"),
    );
    releases[0]!();
    await flush();

    expect(next.state.arrays?.[0]?.path).toBe("/b/r10m");
  });

  it("aborts a replaced load's Zarr reads", async () => {
    const { store, reads } = await geoZarrStore();
    const { resolver, releases } = heldResolver();
    const props = {
      node: zarr.root(store),
      selection: {},
      epsgResolver: resolver,
    };
    const layer = makeBareLayer({ ...props, variable: "a" });
    runInitialUpdate(layer);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const signal = reads[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    // Every read so far, down to the last level's array, carries the signal
    expect(reads.map((read) => read.key)).toContain("/a/r60m/zarr.json");
    expect(reads.every((read) => read.signal === signal)).toBe(true);

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
    vi.spyOn(layer, "loadMetadata").mockReturnValue(new Promise(() => {}));

    runInitialUpdate(layer);

    expect(layer.isLoaded).toBe(false);
  });

  it("is loaded once the Zarr metadata has loaded", async () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "loadMetadata").mockResolvedValue(undefined);

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is loaded after the Zarr metadata fails to load", async () => {
    const layer = makeBareLayer({ onError: () => true });
    vi.spyOn(layer, "loadMetadata").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is not loaded when the old Zarr finishes loading first", async () => {
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
    const next = rerender(layer, { node: {} });
    finishOld();
    await flush();

    expect(next.isLoaded).toBe(false);
  });
});
