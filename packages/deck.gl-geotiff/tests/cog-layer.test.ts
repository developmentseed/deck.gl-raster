import { CompositeLayer } from "@deck.gl/core";
import { Texture } from "@luma.gl/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COGLayer } from "../src/cog-layer.js";

/**
 * Build a {@link COGLayer} ready for direct lifecycle calls: bypasses deck.gl's
 * `LayerManager` by replacing `state` and `setState` with a plain object +
 * assign, mirroring `makeBareLayer` in the deck.gl-raster tests.
 */
function makeBareLayer(props: Record<string, unknown> = {}): COGLayer {
  const layer = new COGLayer({
    id: "cog",
    geotiff: "https://example.com/x.tif",
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
function runInitialUpdate(layer: COGLayer): void {
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
    vi.spyOn(layer, "_parseGeoTIFF").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0]?.[0]?.message).toBe("loading GeoTIFF: boom");
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
    vi.spyOn(layer, "_parseGeoTIFF").mockReturnValue(new Promise(() => {}));

    runInitialUpdate(layer);

    expect(layer.isLoaded).toBe(false);
  });

  it("is loaded once the GeoTIFF has opened", async () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "_parseGeoTIFF").mockResolvedValue(undefined);

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is loaded after the GeoTIFF fails to open", async () => {
    const layer = makeBareLayer({ onError: () => true });
    vi.spyOn(layer, "_parseGeoTIFF").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });
});
