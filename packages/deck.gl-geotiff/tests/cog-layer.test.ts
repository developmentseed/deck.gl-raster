import {
  CompositeLayer,
  LayerManager,
  WebMercatorViewport,
} from "@deck.gl/core";
import type { MinimalTileData } from "@developmentseed/deck.gl-raster";
import type { DecoderPool } from "@developmentseed/geotiff";
import { GeoTIFF } from "@developmentseed/geotiff";
import type { Device } from "@luma.gl/core";
import { Texture } from "@luma.gl/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COGLayer } from "../src/cog-layer.js";
import { COGSource } from "../src/cog-source.js";
import { loadGeoTIFF } from "./helpers.js";

beforeEach(() => {
  // Keep every test off the network: opening a URL never finishes
  vi.spyOn(GeoTIFF, "fromUrl").mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Build a {@link COGLayer} ready for direct lifecycle calls: bypasses deck.gl's
 * `LayerManager` by replacing `state` and `setState` with a plain object +
 * assign, mirroring `makeBareLayer` in the deck.gl-raster tests. Its context
 * has a stub device, enough to infer the default pipeline for the fixtures.
 */
function makeBareLayer(props: Record<string, unknown> = {}): COGLayer {
  const layer = new COGLayer({
    id: "cog",
    source: "https://example.com/x.tif",
    ...props,
  } as never);
  const state: Record<string, unknown> = {};
  Object.assign(layer as object, {
    state,
    setState: (updates: Record<string, unknown>) =>
      Object.assign(state, updates),
    context: { device: {} },
  });
  return layer;
}

/**

 * Run `updateState` as deck.gl does when the layer is first added: the old

 * props are empty.

 */
function runInitialUpdate(layer: COGLayer): void {
  layer.updateState({
    props: layer.props,
    oldProps: {},
    changeFlags: { dataChanged: "init" },
  } as never);
}

/**
 * Render a new {@link COGLayer} with `props`, as apps do on every render:
 * deck.gl hands the new instance the old one's `state`, then runs
 * `updateState`.
 */
function rerender(layer: COGLayer, props: Record<string, unknown>): COGLayer {
  const next = new COGLayer({ id: "cog", ...props } as never);
  Object.assign(next as object, {
    state: layer.state,
    setState: layer.setState,
    context: layer.context,
  });
  next.updateState({
    props: next.props,
    oldProps: layer.props,
    changeFlags: {},
  } as never);
  return next;
}

/** A promise with its `resolve` exposed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Let every settled promise run its handlers. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `COGSource.open` itself, kept from before any test mocks it. */
const openSource = COGSource.open.bind(COGSource);

/** Open a rasterio test fixture as a {@link COGSource}. */
async function openFixture(name: string): Promise<COGSource> {
  return openSource(await loadGeoTIFF(name, "rasterio"));
}

/** Tile callbacks that replace the default pipeline. */
const customPipeline = {
  getTileData: async () => ({}),
  renderTile: () => null,
};

/** The id of the inner TileLayer that `renderLayers` returns. */
function innerTileLayerId(layer: COGLayer): string | undefined {
  return (layer.renderLayers() as { id: string } | null)?.id;
}

function fakeTexture(): {
  texture: Texture;
  destroy: ReturnType<typeof vi.fn>;
} {
  const destroy = vi.fn();
  const texture = Object.create(Texture.prototype) as Texture;
  Object.defineProperty(texture, "destroy", { value: destroy });
  return { texture, destroy };
}

/** Expose the protected `_onTileUnloadCallback` for testing. */
function unloadCallback(layer: COGLayer) {
  return (
    layer as unknown as {
      _onTileUnloadCallback: () =>
        | ((tile: { content: unknown }) => void)
        | undefined;
    }
  )._onTileUnloadCallback();
}

describe("COGLayer._onTileUnloadCallback", () => {
  it("destroys texture + mask and calls the user callback when no getTileData", () => {
    const userCalls: unknown[] = [];
    const layer = new COGLayer({
      id: "cog",
      url: "https://example.com/x.tif",
      onTileUnload: (tile: unknown) => userCalls.push(tile),
    } as never);

    const cb = unloadCallback(layer);
    expect(cb).toBeTypeOf("function");

    const texture = fakeTexture();
    const mask = fakeTexture();
    const tile = { content: { texture: texture.texture, mask: mask.texture } };
    cb?.(tile);

    expect(texture.destroy).toHaveBeenCalledOnce();
    expect(mask.destroy).toHaveBeenCalledOnce();
    expect(userCalls).toEqual([tile]);
  });

  it("tolerates a tile with no data and a missing mask", () => {
    const layer = new COGLayer({
      id: "cog",
      url: "https://example.com/x.tif",
    } as never);
    const cb = unloadCallback(layer);

    expect(() => cb?.({ content: null })).not.toThrow();

    const texture = fakeTexture();
    cb?.({ content: { texture: texture.texture } });
    expect(texture.destroy).toHaveBeenCalledOnce();
  });

  it("returns the user onTileUnload unchanged when getTileData is supplied", () => {
    const onTileUnload = () => {};
    const layer = new COGLayer({
      id: "cog",
      url: "https://example.com/x.tif",
      getTileData: async () => ({
        texture: fakeTexture().texture,
        width: 1,
        height: 1,
        byteLength: 4,
      }),
      renderTile: () => ({ renderPipeline: [] }),
      onTileUnload,
    } as never);

    expect(unloadCallback(layer)).toBe(onTileUnload);
  });
});

describe("COGLayer.updateState", () => {
  it("raises a GeoTIFF open failure through onError", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer({ onError });
    vi.spyOn(layer, "loadMetadata").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0]?.[0]?.message).toBe(
      "Metadata loading failed in COGLayer: boom",
    );
  });

  it("keeps the new source when the old one finishes opening last", async () => {
    const oldSource = await openFixture("cog_uint8_rgba");
    const newSource = await openFixture("cog_uint8_rgba_3857");
    const opens = [deferred<COGSource>(), deferred<COGSource>()];
    vi.spyOn(COGSource, "open")
      .mockReturnValueOnce(opens[0]!.promise)
      .mockReturnValueOnce(opens[1]!.promise);
    const onSourceLoad = vi.fn();
    const props = { onSourceLoad, ...customPipeline };

    const layer = makeBareLayer({
      ...props,
      source: "https://example.com/old.tif",
    });
    runInitialUpdate(layer);
    const next = rerender(layer, {
      ...props,
      source: "https://example.com/new.tif",
    });
    opens[1]!.resolve(newSource);
    await flush();
    opens[0]!.resolve(oldSource);
    await flush();

    expect(next.state.source).toBe(newSource);
    expect(onSourceLoad.mock.calls).toEqual([[newSource]]);
  });

  it("passes its load signal to COGSource.open", () => {
    const open = vi
      .spyOn(COGSource, "open")
      .mockReturnValue(new Promise(() => {}));

    const layer = makeBareLayer({
      ...customPipeline,
      source: "https://example.com/old.tif",
    });
    runInitialUpdate(layer);
    rerender(layer, {
      ...customPipeline,
      source: "https://example.com/new.tif",
    });

    // The first open's signal aborts when the second starts
    expect(
      open.mock.calls.map(([, options]) => options?.signal?.aborted),
    ).toEqual([true, false]);
  });
});

describe("COGLayer source", () => {
  it("draws an opened source without opening anything", async () => {
    const source = await openFixture("cog_uint8_rgba");
    const open = vi.spyOn(COGSource, "open");
    const layer = makeBareLayer({ source, ...customPipeline });

    runInitialUpdate(layer);

    expect(open).not.toHaveBeenCalled();
    expect(layer.state.loadingMetadata).toBeUndefined();
    expect(layer.state.source).toBe(source);
  });

  it("two layers on one source share it without opening it again", async () => {
    const source = await openFixture("cog_uint8_rgba");
    const open = vi.spyOn(COGSource, "open");
    const layers = ["a", "b"].map((id) =>
      makeBareLayer({ id, source, ...customPipeline }),
    );

    for (const layer of layers) {
      runInitialUpdate(layer);
    }

    expect(open).not.toHaveBeenCalled();
    expect(layers[0]!.state.source).toBe(source);
    expect(layers[1]!.state.source).toBe(source);
  });

  it("infers the default pipeline for a source prop", async () => {
    const source = await openFixture("cog_uint8_rgba");
    const layer = makeBareLayer({ source });

    runInitialUpdate(layer);

    expect(layer.state.defaultGetTileData).toBeTypeOf("function");
    expect(layer.state.defaultRenderTile).toBeTypeOf("function");
  });

  it("keeps its inner TileLayer across renders with the same source", async () => {
    const source = await openFixture("cog_uint8_rgba");
    const other = await openFixture("cog_uint8_rgba_3857");
    const layer = makeBareLayer({ source, ...customPipeline });
    runInitialUpdate(layer);
    const id = innerTileLayerId(layer);

    // Every instance shares one state, so read each id right after its render
    const same = rerender(layer, { source, ...customPipeline });
    const sameId = innerTileLayerId(same);
    const replaced = rerender(same, { source: other, ...customPipeline });
    const replacedId = innerTileLayerId(replaced);

    expect(id).toBeDefined();
    expect(sameId).toBe(id);
    expect(replacedId).not.toBe(id);
  });

  it("aborts the shorthand's open when a source replaces it", async () => {
    const source = await openFixture("cog_uint8_rgba");
    const late = await openFixture("cog_uint8_rgba_3857");
    const opening = deferred<COGSource>();
    const open = vi.spyOn(COGSource, "open").mockReturnValue(opening.promise);
    const onSourceLoad = vi.fn();

    const layer = makeBareLayer({ onSourceLoad, ...customPipeline });
    runInitialUpdate(layer);
    const next = rerender(layer, { source, onSourceLoad, ...customPipeline });

    expect(open.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(next.state.loadingMetadata).toBe(false);

    opening.resolve(late);
    await flush();

    expect(onSourceLoad).not.toHaveBeenCalled();
    expect(next.state.source).toBe(source);
  });

  it("opens a COG that replaces an opened source", async () => {
    const source = await openFixture("cog_uint8_rgba");
    const open = vi
      .spyOn(COGSource, "open")
      .mockReturnValue(new Promise(() => {}));
    const url = "https://example.com/x.tif";

    const layer = makeBareLayer({ source, ...customPipeline });
    runInitialUpdate(layer);
    const next = rerender(layer, { source: url, ...customPipeline });

    expect(open.mock.calls.map(([input]) => input)).toEqual([url]);
    // Nothing is drawn until the new COG opens
    expect(next.state.source).toBeUndefined();
  });

  it("draws nothing once its source is removed", async () => {
    const source = await openFixture("cog_uint8_rgba");
    const open = vi.spyOn(COGSource, "open");
    const onError = vi.fn();
    const layer = makeBareLayer({ source, onError, ...customPipeline });
    runInitialUpdate(layer);

    const next = rerender(layer, { onError, ...customPipeline });
    await flush();

    expect(open).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(next.renderLayers()).toBeNull();
  });

  it("reports a source the default pipeline can't draw through onError", async () => {
    const source = await openFixture(
      "float32_1band_deflate_block64_predictor3",
    );
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer({ source, onError });

    runInitialUpdate(layer);

    expect(onError.mock.calls.map(([error]) => error.message)).toEqual([
      expect.stringMatching(
        /^Can't draw the source in COGLayer: .*non-unsigned integers/,
      ),
    ]);
  });

  it("draws nothing, not the old source, after switching to a source the default pipeline can't draw", async () => {
    const drawable = await openFixture("cog_uint8_rgba");
    const undrawable = await openFixture(
      "float32_1band_deflate_block64_predictor3",
    );
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer({ source: drawable, onError });
    runInitialUpdate(layer);

    rerender(layer, { source: undrawable, onError });

    // Every instance shares this state
    expect(layer.state.source).toBeUndefined();
    expect(layer.renderLayers()).toBeNull();
  });
});

describe("COGLayer.isLoaded", () => {
  beforeEach(() => {
    // Report every sublayer as loaded, so only metadata loading decides.
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is not loaded while the GeoTIFF is opening", () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "loadMetadata").mockReturnValue(new Promise(() => {}));

    runInitialUpdate(layer);

    expect(layer.isLoaded).toBe(false);
  });

  it("is loaded once the GeoTIFF has opened", async () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "loadMetadata").mockResolvedValue(undefined);

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is loaded after the GeoTIFF fails to open", async () => {
    const layer = makeBareLayer({ onError: () => true });
    vi.spyOn(layer, "loadMetadata").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is not loaded when the old GeoTIFF finishes opening first", async () => {
    let finishOld!: () => void;
    vi.spyOn(COGLayer.prototype, "loadMetadata")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockReturnValue(new Promise(() => {}));

    const layer = makeBareLayer();
    runInitialUpdate(layer);
    const next = rerender(layer, { source: "https://example.com/y.tif" });
    finishOld();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(next.isLoaded).toBe(false);
  });
});

describe("COGLayer refetching", () => {
  it("fetches its tiles again when updateTriggers.getTileData changes", async () => {
    const source = await openFixture("cog_uint8_rgba");
    const { west, south, east, north } = source.geographicBounds;
    const viewport = new WebMercatorViewport({
      width: 100,
      height: 100,
    }).fitBounds([
      [west, south],
      [east, north],
    ]);
    // A device that draws nothing. The layer reads only its canvas sizes.
    const device = {
      getDefaultCanvasContext: () => ({
        getDrawingBufferSize: () => [100, 100],
        getCSSSize: () => [100, 100],
      }),
    } as unknown as Device;
    const errors: Error[] = [];
    const layerManager = new LayerManager(device, {});
    layerManager.setProps({ onError: (error: Error) => errors.push(error) });
    layerManager.activateViewport(viewport);
    const signals: AbortSignal[] = [];
    const onTileUnload = vi.fn();
    const render = (trigger: number) =>
      layerManager.setLayers([
        new COGLayer<MinimalTileData>({
          id: "cog",
          source,
          // Each load settles only when aborted
          getTileData: (_image, { signal }) => {
            signals.push(signal!);
            return new Promise<never>((_resolve, reject) => {
              signal?.addEventListener("abort", () => reject(signal.reason));
            });
          },
          renderTile: () => null,
          onTileUnload,
          pool: {} as DecoderPool,
          // Start every load at once, without COGLayer's default debounce
          maxRequests: 0,
          debounceTime: 0,
          updateTriggers: { getTileData: [trigger] },
        }),
      ]);

    render(0);
    await flush();
    const first = [...signals];
    render(1);
    await flush();
    // Read these before finalize, which aborts and unloads every tile
    const aborted = first.filter((signal) => signal.aborted).length;
    const unloaded = onTileUnload.mock.calls.length;
    const refetched = signals.length - first.length;
    layerManager.finalize();

    expect(errors).toEqual([]);
    expect(first.length).toBeGreaterThan(0);
    expect(aborted).toBe(first.length);
    expect(unloaded).toBe(first.length);
    expect(refetched).toBe(first.length);
  });
});
