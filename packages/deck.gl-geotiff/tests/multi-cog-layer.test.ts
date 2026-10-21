import { CompositeLayer } from "@deck.gl/core";
import { Texture } from "@luma.gl/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MultiCOGLayer } from "../src/multi-cog-layer.js";

/**
 * Build a {@link MultiCOGLayer} ready for direct lifecycle calls: bypasses
 * deck.gl's `LayerManager` by replacing `state` and `setState` with a plain
 * object + assign, mirroring `makeBareLayer` in the deck.gl-raster tests.
 */
function makeBareLayer(props: Record<string, unknown> = {}): MultiCOGLayer {
  const layer = new MultiCOGLayer({
    id: "multi",
    sources: { a: { url: "https://example.com/a.tif" } },
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

/** Run `updateState` as deck.gl does when the layer is first added. */
function runInitialUpdate(layer: MultiCOGLayer): void {
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: { dataChanged: true },
  } as never);
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

function unloadCallback(layer: MultiCOGLayer) {
  return (
    layer as unknown as {
      _onTileUnloadCallback: () =>
        | ((tile: { content: unknown }) => void)
        | undefined;
    }
  )._onTileUnloadCallback();
}

describe("MultiCOGLayer._onTileUnloadCallback", () => {
  it("destroys every band texture and calls the user callback", () => {
    const userCalls: unknown[] = [];
    const layer = new MultiCOGLayer({
      id: "multi",
      sources: {},
      onTileUnload: (tile: unknown) => userCalls.push(tile),
    } as never);

    const cb = unloadCallback(layer);
    expect(cb).toBeTypeOf("function");

    const texA = fakeTexture();
    const texB = fakeTexture();
    const bands = new Map([
      ["a", { texture: texA.texture }],
      ["b", { texture: texB.texture }],
    ]);
    const tile = { content: { bands } };
    cb?.(tile);

    expect(texA.destroy).toHaveBeenCalledOnce();
    expect(texB.destroy).toHaveBeenCalledOnce();
    expect(userCalls).toEqual([tile]);
  });

  it("tolerates a tile with no data", () => {
    const layer = new MultiCOGLayer({ id: "multi", sources: {} } as never);
    const cb = unloadCallback(layer);
    expect(() => cb?.({ content: null })).not.toThrow();
  });
});

describe("MultiCOGLayer.updateState", () => {
  it("raises a COG open failure through onError", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = new MultiCOGLayer({
      id: "multi",
      sources: { a: { url: "https://example.com/a.tif" } },
      onError,
    } as never);
    vi.spyOn(layer, "setState").mockImplementation(() => {});
    vi.spyOn(layer, "_parseAllSources").mockRejectedValue(new Error("boom"));

    layer.updateState({
      props: layer.props,
      oldProps: layer.props,
      changeFlags: { dataChanged: true },
    } as never);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    const error = onError.mock.calls[0]?.[0];
    expect(error?.message).toBe("loading COG sources: boom");
    expect(error?.cause).toBeInstanceOf(Error);
  });
});

describe("MultiCOGLayer.isLoaded", () => {
  beforeEach(() => {
    // Report every sublayer as loaded, so only metadata loading decides.
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is not loaded while the COG sources are opening", () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "_parseAllSources").mockReturnValue(new Promise(() => {}));

    runInitialUpdate(layer);

    expect(layer.isLoaded).toBe(false);
  });

  it("is loaded once the COG sources have opened", async () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "_parseAllSources").mockResolvedValue(undefined);

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is loaded after a COG source fails to open", async () => {
    const layer = makeBareLayer({ onError: () => true });
    vi.spyOn(layer, "_parseAllSources").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });
});
