import { CompositeLayer } from "@deck.gl/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** Run `updateState` as deck.gl does when the layer is first added. */
function runInitialUpdate(layer: ZarrLayer): void {
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: { dataChanged: true },
  } as never);
}

describe("ZarrLayer.updateState", () => {
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
    vi.spyOn(layer, "_parseZarr").mockResolvedValue(undefined);

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is loaded after the Zarr metadata fails to load", async () => {
    const layer = makeBareLayer({ onError: () => true });
    vi.spyOn(layer, "_parseZarr").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });
});
