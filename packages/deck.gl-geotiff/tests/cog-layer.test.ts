import { CompositeLayer } from "@deck.gl/core";
import { epsgResolver } from "@developmentseed/proj";
import { Texture } from "@luma.gl/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COGLayer } from "../src/cog-layer.js";
import { loadGeoTIFF } from "./helpers.js";

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
  });
  next.updateState({
    props: next.props,
    oldProps: layer.props,
    changeFlags: {},
  } as never);
  return next;
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

  it("keeps the new GeoTIFF when the old one finishes opening last", async () => {
    // The old GeoTIFF is in EPSG:4326 and the new one in EPSG:3857.
    const oldGeoTIFF = await loadGeoTIFF("cog_uint8_rgba", "rasterio");
    const newGeoTIFF = await loadGeoTIFF("cog_uint8_rgba_3857", "rasterio");
    // Hold each CRS lookup until the test releases it.
    const lookups = new Map<number, () => void>();
    const onGeoTIFFLoad = vi.fn();
    const props = {
      epsgResolver: (epsg: number) =>
        new Promise((resolve) =>
          lookups.set(epsg, () => resolve(epsgResolver(epsg))),
        ),
      onGeoTIFFLoad,
      // Skip the default pipeline, which needs a device.
      getTileData: async () => ({}),
      renderTile: () => null,
    };

    const layer = makeBareLayer({ ...props, geotiff: oldGeoTIFF });
    const oldLoad = vi.spyOn(layer, "loadMetadata");
    runInitialUpdate(layer);
    const next = rerender(layer, { ...props, geotiff: newGeoTIFF });
    await vi.waitFor(() => expect(lookups.size).toBe(2));

    lookups.get(3857)!();
    await vi.waitFor(() => expect(next.state.geotiff?.crs).toBe(3857));
    lookups.get(4326)!();
    // The old load is aborted
    await expect(oldLoad.mock.results[0]!.value).rejects.toThrow();

    expect(next.state.geotiff?.crs).toBe(3857);
    expect(onGeoTIFFLoad.mock.calls.map(([geotiff]) => geotiff.crs)).toEqual([
      3857,
    ]);
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
    const next = rerender(layer, { geotiff: "https://example.com/y.tif" });
    finishOld();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(next.isLoaded).toBe(false);
  });
});
