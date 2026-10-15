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

describe("RasterTileLayer._errorSpace", () => {
  it("passes _errorSpace to each tile's RasterLayer", () => {
    const layer = new RasterTileLayer({
      id: "t",
      _errorSpace: "output",
    } as RasterTileLayerProps);
    Object.assign(layer as object, {
      context: { viewport: { resolution: undefined } },
      getSubLayerProps: <T>(props: T) => props,
    });
    const identity = (x: number, y: number): [number, number] => [x, y];
    const tile = {
      forwardTransform: identity,
      inverseTransform: identity,
      _projectPosition: identity,
      _unprojectPosition: identity,
      _webMercatorInitialTriangulation: undefined,
    };
    const layers = (
      layer as unknown as {
        _renderSubLayers: (
          ...args: unknown[]
        ) => { props: Record<string, unknown> }[];
      }
    )._renderSubLayers(
      { id: "t-0-0-0", data: { width: 4, height: 4 }, tile, _offset: 0 },
      {},
      () => ({ image: {} }),
    );
    expect(layers[0]!.props._errorSpace).toBe("output");
  });
});

describe("RasterTileLayer world wrap", () => {
  /** The props of one tile's RasterLayer, rendered in the given view. */
  function rasterLayerProps(
    props: Partial<RasterTileLayerProps>,
    { globe = false } = {},
  ): Record<string, unknown> {
    const layer = new RasterTileLayer({
      id: "t",
      ...props,
    } as RasterTileLayerProps);
    Object.assign(layer as object, {
      context: { viewport: { resolution: globe ? 1 : undefined } },
      getSubLayerProps: <T>(p: T) => p,
    });
    const identity = (x: number, y: number): [number, number] => [x, y];
    const tile = {
      forwardTransform: identity,
      inverseTransform: identity,
      _projectPosition: identity,
      _unprojectPosition: identity,
      _webMercatorInitialTriangulation: undefined,
    };
    const layers = (
      layer as unknown as {
        _renderSubLayers: (
          ...args: unknown[]
        ) => { props: Record<string, unknown> }[];
      }
    )._renderSubLayers(
      { id: "t-0-0-0", data: { width: 4, height: 4 }, tile, _offset: 0 },
      {},
      () => ({ image: {} }),
    );
    return layers[0]!.props;
  }

  it("wraps Web Mercator meshes at one world in output mode", () => {
    expect(rasterLayerProps({ _errorSpace: "output" })._wrapX).toBe(512);
  });

  it("doesn't wrap in input mode, which can't", () => {
    expect(rasterLayerProps({})._wrapX).toBeUndefined();
    expect(rasterLayerProps({ _errorSpace: "input" })._wrapX).toBeUndefined();
  });

  it("doesn't wrap on the globe, which has no world edge", () => {
    expect(
      rasterLayerProps({ _errorSpace: "output" }, { globe: true })._wrapX,
    ).toBeUndefined();
  });
});
