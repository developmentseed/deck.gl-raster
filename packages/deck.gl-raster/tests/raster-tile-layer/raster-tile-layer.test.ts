import { CompositeLayer } from "@deck.gl/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RasterTileLayerProps } from "../../src/raster-tile-layer/index.js";
import { RasterTileLayer } from "../../src/raster-tile-layer/index.js";

describe("RasterTileLayer", () => {
  it("is importable and has the expected layerName", () => {
    expect(RasterTileLayer.layerName).toBe("RasterTileLayer");
  });

  it("exposes defaults for maxError, debug, and debugOpacity", () => {
    const dp = RasterTileLayer.defaultProps as Partial<RasterTileLayerProps>;
    expect(dp.maxError).toBe(0.125);
    expect(dp.debug).toBe(false);
    expect(dp.debugOpacity).toBe(0.5);
  });

  it("can be constructed with no props without throwing", () => {
    expect(() => new RasterTileLayer({ id: "test" })).not.toThrow();
  });

  it("exposes a _renderDebug hook returning [] when no descriptor is configured", () => {
    class ProbeLayer extends RasterTileLayer {
      callDebug(tile: unknown, data: unknown) {
        return (
          this as unknown as {
            _renderDebug: (t: unknown, d: unknown) => unknown[];
          }
        )._renderDebug(tile, data);
      }
    }
    const layer = new ProbeLayer({ id: "probe" });
    expect(layer.callDebug({ id: "x" }, null)).toEqual([]);
  });

  it("base _onTileUnloadCallback returns the user onTileUnload unchanged", () => {
    const onTileUnload = () => {};
    class ProbeLayer extends RasterTileLayer {
      callUnload() {
        return (
          this as unknown as {
            _onTileUnloadCallback: () => unknown;
          }
        )._onTileUnloadCallback();
      }
    }
    const layer = new ProbeLayer({ id: "probe", onTileUnload });
    expect(layer.callUnload()).toBe(onTileUnload);
  });
});

describe("RasterTileLayer.isLoaded", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Stub deck.gl's sublayer check (`CompositeLayer.isLoaded`). */
  function stubSublayersLoaded(loaded: boolean) {
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(
      loaded,
    );
  }

  class LoadingMetadataLayer extends RasterTileLayer {
    protected override _isLoadingMetadata(): boolean {
      return true;
    }
  }

  it("is not loaded while metadata is loading, even with no sublayers pending", () => {
    stubSublayersLoaded(true);
    const layer = new LoadingMetadataLayer({ id: "test" });
    expect(layer.isLoaded).toBe(false);
  });

  it("is not loaded while sublayers are loading", () => {
    stubSublayersLoaded(false);
    const layer = new RasterTileLayer({ id: "test" });
    expect(layer.isLoaded).toBe(false);
  });

  it("is loaded when no metadata is pending and sublayers are loaded", () => {
    stubSublayersLoaded(true);
    const layer = new RasterTileLayer({ id: "test" });
    expect(layer.isLoaded).toBe(true);
  });
});
