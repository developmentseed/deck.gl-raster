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

describe("RasterTileLayer zRange", () => {
  /** The props of the inner TileLayer that `renderLayers` returns. */
  function innerTileLayerProps(
    props: Partial<RasterTileLayerProps>,
  ): Record<string, unknown> | undefined {
    const layer = new RasterTileLayer({
      id: "t",
      tilesetDescriptor: {} as RasterTileLayerProps["tilesetDescriptor"],
      getTileData: vi.fn(),
      renderTile: vi.fn(),
      ...props,
    });
    Object.assign(layer as object, { context: { device: {} } });
    const tileLayer = layer.renderLayers() as {
      props: Record<string, unknown>;
    } | null;
    return tileLayer?.props;
  }

  it("passes zRange to its inner TileLayer", () => {
    expect(innerTileLayerProps({ zRange: [500, 2500] })?.zRange).toEqual([
      500, 2500,
    ]);
  });

  it("passes null when zRange is unset", () => {
    expect(innerTileLayerProps({})?.zRange).toBeNull();
  });

  it("treats a new zRange array with the same heights as unchanged", () => {
    // deck.gl diffs each prop with its prop type's `equal`, which it keeps on
    // the props under this symbol.
    type PropType = {
      equal: (a: unknown, b: unknown, propType: PropType) => boolean;
    };
    const layer = new RasterTileLayer({ id: "t" });
    const propTypes = (
      layer.props as unknown as Record<symbol, Record<string, PropType>>
    )[Symbol.for("propTypes")]!;
    const zRange = propTypes.zRange!;
    expect(zRange.equal([500, 2100], [500, 2100], zRange)).toBe(true);
    expect(zRange.equal([500, 2100], [500, 2600], zRange)).toBe(false);
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

  it("wraps Web Mercator meshes at one world", () => {
    expect(rasterLayerProps({})._wrapX).toBe(512);
  });

  it("doesn't wrap on the globe, which has no world edge", () => {
    expect(rasterLayerProps({}, { globe: true })._wrapX).toBeUndefined();
  });
});

describe("RasterTileLayer._reloadMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A promise with its `resolve` and `reject` exposed. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /** A load started by {@link MetadataTestLayer}, settled by the test. */
  type Load = { signal: AbortSignal } & ReturnType<typeof deferred<string>>;

  /**
   * Overrides `_loadMetadata` as subclasses must: wait for the load, check the
   * signal after the last `await`, then `setState`. Each load is pushed to the
   * `loads` prop for the test to settle.
   */
  class MetadataTestLayer extends RasterTileLayer {
    start(): void {
      this._reloadMetadata({ errorMsg: "loading test" });
    }

    protected override async _loadMetadata(signal: AbortSignal): Promise<void> {
      const load = { signal, ...deferred<string>() };
      (this.props as unknown as { loads: Load[] }).loads.push(load);
      const result = await load.promise;
      signal.throwIfAborted();
      this.setState({ result });
    }
  }

  /**
   * Build a {@link MetadataTestLayer} ready for direct lifecycle calls: replace
   * `state` and `setState` with a plain object + assign.
   */
  function makeBareLayer(props: Record<string, unknown>): MetadataTestLayer {
    const layer = new MetadataTestLayer({ id: "test", ...props } as never);
    const state: Record<string, unknown> = {};
    Object.assign(layer as object, {
      state,
      setState: (updates: Record<string, unknown>) =>
        Object.assign(state, updates),
    });
    return layer;
  }

  /**
   * Render a new instance with `props`, as apps do on every render: deck.gl
   * hands it the old instance's `state`.
   */
  function rerender(
    layer: MetadataTestLayer,
    props: Record<string, unknown>,
  ): MetadataTestLayer {
    const next = new MetadataTestLayer({ id: "test", ...props } as never);
    Object.assign(next as object, {
      state: layer.state,
      setState: layer.setState,
    });
    return next;
  }

  /** Let every settled promise run its handlers. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("keeps the latest load's result when an older load finishes last", async () => {
    const loads: Load[] = [];
    const layer = makeBareLayer({ loads });
    layer.start();
    const next = rerender(layer, { loads });
    next.start();

    loads[1]!.resolve("b");
    await flush();
    loads[0]!.resolve("a");
    await flush();

    expect(next.state.result).toBe("b");
  });

  it("stays loading until the latest load settles", async () => {
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(true);
    const loads: Load[] = [];
    const layer = makeBareLayer({ loads });
    layer.start();
    const next = rerender(layer, { loads });
    next.start();

    loads[0]!.resolve("a");
    await flush();
    expect(next.isLoaded).toBe(false);

    loads[1]!.resolve("b");
    await flush();
    expect(next.isLoaded).toBe(true);
  });

  it("raises only the latest load's error", async () => {
    const onError = vi.fn((_error: Error) => true);
    const loads: Load[] = [];
    const layer = makeBareLayer({ loads, onError });
    layer.start();
    const next = rerender(layer, { loads, onError });
    next.start();

    loads[0]!.reject(new Error("a"));
    await flush();
    expect(onError).not.toHaveBeenCalled();

    loads[1]!.reject(new Error("boom"));
    await flush();
    expect(onError.mock.calls.map(([error]) => error.message)).toEqual([
      "loading test: boom",
    ]);
  });

  it("stops loading when the latest load fails", async () => {
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(true);
    const loads: Load[] = [];
    const layer = makeBareLayer({ loads, onError: () => true });
    layer.start();

    loads[0]!.reject(new Error("boom"));
    await flush();

    expect(layer.isLoaded).toBe(true);
  });

  it("aborts the load in flight when the layer is removed", () => {
    const loads: Load[] = [];
    const layer = makeBareLayer({ loads });
    layer.start();

    layer.finalizeState({} as never);

    expect(loads[0]!.signal.aborted).toBe(true);
  });

  it("aborts the previous load's signal when a new load starts", () => {
    const loads: Load[] = [];
    const layer = makeBareLayer({ loads });
    layer.start();
    const next = rerender(layer, { loads });
    next.start();

    expect(loads.map((load) => load.signal.aborted)).toEqual([true, false]);
  });
});
