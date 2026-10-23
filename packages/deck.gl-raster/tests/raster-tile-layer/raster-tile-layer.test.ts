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

describe("RasterTileLayer._loadMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Exposes the protected `_loadMetadata` to the tests. */
  class MetadataTestLayer extends RasterTileLayer {
    start<T>(
      load: (signal: AbortSignal) => Promise<T>,
      apply: (layer: this, result: T) => void,
    ): void {
      this._loadMetadata({ load, apply, errorContext: "loading test" });
    }
  }

  /**
   * The newest instance of each bare layer, keyed by the `state` object that
   * all its instances share. deck.gl keeps this pointer in its internal layer
   * state and returns it from `getCurrentLayer()`.
   */
  const currentLayers = new WeakMap<object, { layer: MetadataTestLayer }>();

  /**
   * Build a {@link MetadataTestLayer} ready for direct lifecycle calls: replace
   * `state` and `setState` with a plain object + assign, and stub
   * `getCurrentLayer` to return the newest instance.
   */
  function makeBareLayer(
    props: Record<string, unknown> = {},
  ): MetadataTestLayer {
    const layer = new MetadataTestLayer({ id: "test", ...props } as never);
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

  /**
   * Render a new instance with `props`, as apps do on every render: deck.gl
   * hands it the old instance's `state` and makes it the current layer.
   */
  function rerender(
    layer: MetadataTestLayer,
    props: Record<string, unknown> = {},
  ): MetadataTestLayer {
    const next = new MetadataTestLayer({ id: "test", ...props } as never);
    Object.assign(next as object, {
      state: layer.state,
      setState: layer.setState,
      getCurrentLayer: layer.getCurrentLayer,
    });
    currentLayers.get(layer.state)!.layer = next;
    return next;
  }

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

  /** Let every settled promise run its handlers. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("applies the latest load's result to the current layer", async () => {
    const layer = makeBareLayer();
    const load = deferred<string>();
    const apply = vi.fn();
    layer.start(() => load.promise, apply);
    const next = rerender(layer);

    load.resolve("a");
    await flush();

    expect(apply).toHaveBeenCalledExactlyOnceWith(next, "a");
  });

  it("drops a load that a newer load replaced", async () => {
    const layer = makeBareLayer();
    const a = deferred<string>();
    const b = deferred<string>();
    const apply = vi.fn();
    layer.start(() => a.promise, apply);
    const next = rerender(layer);
    next.start(() => b.promise, apply);

    b.resolve("b");
    await flush();
    a.resolve("a");
    await flush();

    expect(apply.mock.calls.map(([, result]) => result)).toEqual(["b"]);
  });

  it("stays loading until the latest load settles", async () => {
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(true);
    const layer = makeBareLayer();
    const a = deferred<string>();
    const b = deferred<string>();
    layer.start(
      () => a.promise,
      () => {},
    );
    const next = rerender(layer);
    next.start(
      () => b.promise,
      () => {},
    );

    a.resolve("a");
    await flush();
    expect(next.isLoaded).toBe(false);

    b.resolve("b");
    await flush();
    expect(next.isLoaded).toBe(true);
  });

  it("raises only the latest load's error", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer({ onError });
    const a = deferred<string>();
    const b = deferred<string>();
    layer.start(
      () => a.promise,
      () => {},
    );
    const next = rerender(layer, { onError });
    next.start(
      () => b.promise,
      () => {},
    );

    a.reject(new Error("a"));
    await flush();
    expect(onError).not.toHaveBeenCalled();

    b.reject(new Error("boom"));
    await flush();
    expect(onError.mock.calls.map(([error]) => error.message)).toEqual([
      "loading test: boom",
    ]);
  });

  it("reports an error thrown by apply", async () => {
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(true);
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer({ onError });

    layer.start(
      async () => "a",
      () => {
        throw new Error("bad");
      },
    );
    await flush();

    expect(onError.mock.calls.map(([error]) => error.message)).toEqual([
      "loading test: bad",
    ]);
    expect(layer.isLoaded).toBe(true);
  });

  it("aborts the load in flight when the layer is removed", async () => {
    const layer = makeBareLayer();
    const load = deferred<string>();
    let signal!: AbortSignal;
    const apply = vi.fn();
    layer.start((s) => {
      signal = s;
      return load.promise;
    }, apply);

    layer.finalizeState({} as never);
    expect(signal.aborted).toBe(true);

    load.resolve("a");
    await flush();
    expect(apply).not.toHaveBeenCalled();
  });

  it("aborts the previous load's signal when a new load starts", () => {
    const layer = makeBareLayer();
    const signals: AbortSignal[] = [];
    const load = (signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => {});
    };
    layer.start(load, () => {});
    const next = rerender(layer);
    next.start(load, () => {});

    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
  });
});
