import type { UpdateParameters } from "@deck.gl/core";
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

describe("RasterTileLayer.loadMetadata", () => {
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

  /** The test props {@link MetadataTestLayer} reads. */
  type TestProps = { input: string; loads: Load[] };

  /**
   * Loads metadata as subclasses must. `shouldLoadMetadata` asks for a load
   * when the `input` prop changes. `loadMetadata` pushes each load to the
   * `loads` prop for the test to settle, then checks the signal after its last
   * `await`, before `setState`.
   */
  class MetadataTestLayer extends RasterTileLayer {
    declare state: RasterTileLayer["state"] & { result?: string };
    static override layerName = "MetadataTestLayer";

    override shouldLoadMetadata({
      props,
      oldProps,
    }: UpdateParameters<this>): boolean {
      const { input } = props as unknown as TestProps;
      const { input: oldInput } = oldProps as unknown as TestProps;
      return input !== oldInput;
    }

    override async loadMetadata(signal: AbortSignal): Promise<void> {
      const load = { signal, ...deferred<string>() };
      (this.props as unknown as TestProps).loads.push(load);
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

   * Run `updateState` as deck.gl does when the layer is first added: the old

   * props are empty.

   */
  function runInitialUpdate(layer: MetadataTestLayer): void {
    layer.updateState({
      props: layer.props,
      oldProps: {},
      changeFlags: { dataChanged: "init" },
    } as never);
  }

  /**
   * Render a new instance with `props`, as apps do on every render: deck.gl
   * hands it the old instance's `state`, then runs `updateState`.
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
    next.updateState({
      props: next.props,
      oldProps: layer.props,
      changeFlags: {},
    } as never);
    return next;
  }

  /** Let every settled promise run its handlers. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("keeps the latest load's result when an older load finishes last", async () => {
    const loads: Load[] = [];
    const layer = makeBareLayer({ input: "a", loads });
    runInitialUpdate(layer);
    const next = rerender(layer, { input: "b", loads });

    loads[1]!.resolve("b");
    await flush();
    loads[0]!.resolve("a");
    await flush();

    expect(next.state.result).toBe("b");
  });

  it("doesn't load again when the input is unchanged", () => {
    const loads: Load[] = [];
    const layer = makeBareLayer({ input: "a", loads });
    runInitialUpdate(layer);
    rerender(layer, { input: "a", loads });

    expect(loads).toHaveLength(1);
  });

  it("stays loading until the latest load settles", async () => {
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(true);
    const loads: Load[] = [];
    const layer = makeBareLayer({ input: "a", loads });
    runInitialUpdate(layer);
    const next = rerender(layer, { input: "b", loads });

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
    const layer = makeBareLayer({ input: "a", loads, onError });
    runInitialUpdate(layer);
    rerender(layer, { input: "b", loads, onError });

    loads[0]!.reject(new Error("a"));
    await flush();
    expect(onError).not.toHaveBeenCalled();

    loads[1]!.reject(new Error("boom"));
    await flush();
    expect(onError.mock.calls.map(([error]) => error.message)).toEqual([
      "Metadata loading failed in MetadataTestLayer: boom",
    ]);
  });

  it("stops loading when the latest load fails", async () => {
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(true);
    const loads: Load[] = [];
    const layer = makeBareLayer({ input: "a", loads, onError: () => true });
    runInitialUpdate(layer);

    loads[0]!.reject(new Error("boom"));
    await flush();

    expect(layer.isLoaded).toBe(true);
  });

  it("aborts the load in flight when the layer is removed", () => {
    const loads: Load[] = [];
    const layer = makeBareLayer({ input: "a", loads });
    runInitialUpdate(layer);

    layer.finalizeState({} as never);

    expect(loads[0]!.signal.aborted).toBe(true);
  });

  it("aborts the previous load's signal when a new load starts", () => {
    const loads: Load[] = [];
    const layer = makeBareLayer({ input: "a", loads });
    runInitialUpdate(layer);
    rerender(layer, { input: "b", loads });

    expect(loads.map((load) => load.signal.aborted)).toEqual([true, false]);
  });

  it("abortMetadataLoad aborts the load in flight and stops loading", async () => {
    const onError = vi.fn();
    const loads: Load[] = [];
    const layer = makeBareLayer({ input: "a", loads, onError });
    runInitialUpdate(layer);

    (layer as unknown as { _abortMetadataLoad(): void })._abortMetadataLoad();
    loads[0]!.reject(new Error("late"));
    await flush();

    expect(loads[0]!.signal.aborted).toBe(true);
    expect(layer.state.loadingMetadata).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("abortMetadataLoad sets no state when no load is in flight", () => {
    const layer = makeBareLayer({ input: undefined, loads: [] });
    const setState = vi.spyOn(layer, "setState");

    (layer as unknown as { _abortMetadataLoad(): void })._abortMetadataLoad();

    expect(setState).not.toHaveBeenCalled();
  });
});

describe("RasterTileLayer inner TileLayer id", () => {
  /** The id of the inner TileLayer that `renderLayers` returns. */
  function innerTileLayerId(layer: RasterTileLayer): string | undefined {
    Object.assign(layer as object, { context: { device: {} } });
    return (layer.renderLayers() as { id: string } | null)?.id;
  }

  const props = {
    id: "t",
    tilesetDescriptor: {} as RasterTileLayerProps["tilesetDescriptor"],
    getTileData: vi.fn(),
    renderTile: vi.fn(),
  };

  it("names it after the layer by default", () => {
    expect(innerTileLayerId(new RasterTileLayer(props))).toBe(
      "raster-tile-layer-t",
    );
  });

  it("names it with _tileLayerId", () => {
    class CustomIdLayer extends RasterTileLayer {
      protected override _tileLayerId(): string {
        return "custom";
      }
    }

    expect(innerTileLayerId(new CustomIdLayer(props))).toBe("custom");
  });
});
