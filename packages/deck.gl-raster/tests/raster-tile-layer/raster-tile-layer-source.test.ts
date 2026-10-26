import { describe, expect, it, vi } from "vitest";
import { RasterSource } from "../../src/raster-source.js";
import { RasterTileLayer } from "../../src/raster-tile-layer/index.js";
import type { RasterTilesetDescriptor } from "../../src/raster-tileset/index.js";

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

/** A {@link RasterSource} with a name, to tell sources apart. */
class TestSource extends RasterSource {
  readonly name: string;

  constructor(name: string) {
    super({
      tilesetDescriptor: {} as RasterTilesetDescriptor,
      geographicBounds: { west: 0, south: 0, east: 1, north: 1 },
    });
    this.name = name;
  }
}

/** An open started by {@link SourceTestLayer}, settled by the test. */
type Open = { input: string; signal: AbortSignal } & ReturnType<
  typeof deferred<TestSource>
>;

/** The test props {@link SourceTestLayer} reads. */
type TestProps = { opens: Open[] };

/**
 * Takes a `source` as layers with sources do. `_openSource` pushes each open
 * to the `opens` prop for the test to settle. `_sourceState` derives `drawn`
 * from a source, and throws for one named "undrawable".
 */
class SourceTestLayer extends RasterTileLayer {
  static override layerName = "SourceTestLayer";
  declare state: RasterTileLayer["state"] & { drawn?: string };

  protected override _openSource(
    input: string,
    signal: AbortSignal,
  ): Promise<TestSource> {
    const open = { input, signal, ...deferred<TestSource>() };
    (this.props as unknown as TestProps).opens.push(open);
    return open.promise;
  }

  protected override _sourceState(source: TestSource) {
    if (source.name === "undrawable") {
      throw new Error("can't draw undrawable");
    }
    return { drawn: source.name };
  }
}

/**
 * Build a layer ready for direct lifecycle calls: replace `state` and
 * `setState` with a plain object + assign.
 */
function makeBareLayer<L extends RasterTileLayer>(
  Layer: new (props: never) => L,
  props: Record<string, unknown>,
): L {
  const layer = new Layer({ id: "test", ...props } as never);
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
function runInitialUpdate(layer: RasterTileLayer): void {
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
function rerender<L extends RasterTileLayer>(
  layer: L,
  props: Record<string, unknown>,
): L {
  const Layer = layer.constructor as new (props: never) => L;
  const next = new Layer({ id: "test", ...props } as never);
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

/** The protected `_tilesetDescriptor()` of `layer`. */
function tilesetDescriptor(layer: RasterTileLayer): unknown {
  return (
    layer as unknown as { _tilesetDescriptor(): unknown }
  )._tilesetDescriptor();
}

describe("RasterTileLayer source", () => {
  it("draws an opened source without opening anything", () => {
    const opens: Open[] = [];
    const source = new TestSource("a");
    const layer = makeBareLayer(SourceTestLayer, { source, opens });

    runInitialUpdate(layer);

    expect(opens).toEqual([]);
    expect(layer.state.source).toBe(source);
    expect(layer.state.loadingMetadata).toBeUndefined();
  });

  it("takes its tile grid from the source it draws", () => {
    const source = new TestSource("a");
    const layer = makeBareLayer(SourceTestLayer, { source, opens: [] });

    runInitialUpdate(layer);

    expect(tilesetDescriptor(layer)).toBe(source.tilesetDescriptor);
  });

  it("opens other input with its load signal", () => {
    const opens: Open[] = [];
    const layer = makeBareLayer(SourceTestLayer, { source: "a.tif", opens });

    runInitialUpdate(layer);

    expect(opens.map((open) => open.input)).toEqual(["a.tif"]);
    expect(opens[0]!.signal.aborted).toBe(false);
    expect(layer.state.source).toBeUndefined();
  });

  it("calls onSourceLoad with the source it opened, and draws it", async () => {
    const opens: Open[] = [];
    const onSourceLoad = vi.fn();
    const layer = makeBareLayer(SourceTestLayer, {
      source: "a.tif",
      onSourceLoad,
      opens,
    });
    runInitialUpdate(layer);

    const opened = new TestSource("a");
    opens[0]!.resolve(opened);
    await flush();

    expect(onSourceLoad.mock.calls).toEqual([[opened]]);
    expect(layer.state.source).toBe(opened);
  });

  it("doesn't open again when source is unchanged", () => {
    const opens: Open[] = [];
    const layer = makeBareLayer(SourceTestLayer, { source: "a.tif", opens });
    runInitialUpdate(layer);

    rerender(layer, { source: "a.tif", opens });

    expect(opens).toHaveLength(1);
  });

  it("keeps the newer source when an older open finishes last", async () => {
    const opens: Open[] = [];
    const onSourceLoad = vi.fn();
    const layer = makeBareLayer(SourceTestLayer, {
      source: "a.tif",
      onSourceLoad,
      opens,
    });
    runInitialUpdate(layer);
    const next = rerender(layer, { source: "b.tif", onSourceLoad, opens });

    const a = new TestSource("a");
    const b = new TestSource("b");
    opens[1]!.resolve(b);
    await flush();
    opens[0]!.resolve(a);
    await flush();

    expect(next.state.source).toBe(b);
    expect(onSourceLoad.mock.calls).toEqual([[b]]);
  });

  it("aborts an open in flight when an opened source replaces it", async () => {
    const opens: Open[] = [];
    const onSourceLoad = vi.fn();
    const layer = makeBareLayer(SourceTestLayer, {
      source: "a.tif",
      onSourceLoad,
      opens,
    });
    runInitialUpdate(layer);
    const source = new TestSource("b");
    const next = rerender(layer, { source, onSourceLoad, opens });

    expect(opens[0]!.signal.aborted).toBe(true);
    expect(next.state.loadingMetadata).toBe(false);

    opens[0]!.resolve(new TestSource("late"));
    await flush();

    expect(onSourceLoad).not.toHaveBeenCalled();
    expect(next.state.source).toBe(source);
  });

  it("draws nothing while input that replaced a source opens", () => {
    const opens: Open[] = [];
    const layer = makeBareLayer(SourceTestLayer, {
      source: new TestSource("a"),
      opens,
    });
    runInitialUpdate(layer);

    const next = rerender(layer, { source: "b.tif", opens });

    expect(next.state.source).toBeUndefined();
    expect(opens).toHaveLength(1);
  });

  it("draws nothing once source is removed, without opening or an error", async () => {
    const opens: Open[] = [];
    const onError = vi.fn();
    const source = new TestSource("a");
    const layer = makeBareLayer(SourceTestLayer, { source, onError, opens });
    runInitialUpdate(layer);
    expect(layer.state.source).toBe(source);

    const next = rerender(layer, { onError, opens });
    await flush();

    expect(next.state.source).toBeUndefined();
    expect(opens).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("stores the state that _sourceState derives with the source", () => {
    const layer = makeBareLayer(SourceTestLayer, {
      source: new TestSource("a"),
      opens: [],
    });

    runInitialUpdate(layer);

    expect(layer.state.drawn).toBe("a");
  });

  it("draws nothing, not the old source, when _sourceState throws for a new source", () => {
    const layer = makeBareLayer(SourceTestLayer, {
      source: new TestSource("a"),
      opens: [],
    });
    runInitialUpdate(layer);

    expect(() =>
      rerender(layer, { source: new TestSource("undrawable"), opens: [] }),
    ).toThrow(/can't draw undrawable/);

    // Every instance shares this state
    expect(layer.state.source).toBeUndefined();
  });

  it("aborts the open in flight even when _sourceState throws for the source that replaced it", () => {
    const opens: Open[] = [];
    const layer = makeBareLayer(SourceTestLayer, { source: "a.tif", opens });
    runInitialUpdate(layer);

    expect(() =>
      rerender(layer, { source: new TestSource("undrawable"), opens }),
    ).toThrow(/can't draw undrawable/);

    expect(opens[0]!.signal.aborted).toBe(true);
  });

  it("reports a _sourceState error for a source it opened through onError", async () => {
    const opens: Open[] = [];
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer(SourceTestLayer, {
      source: "a.tif",
      onError,
      opens,
    });
    runInitialUpdate(layer);

    opens[0]!.resolve(new TestSource("undrawable"));
    await flush();

    expect(onError.mock.calls.map(([error]) => error.message)).toEqual([
      "Metadata loading failed in SourceTestLayer: can't draw undrawable",
    ]);
    expect(layer.state.source).toBeUndefined();
  });

  it("rejects input when the layer can't open a source", async () => {
    class PlainLayer extends RasterTileLayer {
      static override layerName = "PlainLayer";
    }
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer(PlainLayer, { source: "a.tif", onError });

    runInitialUpdate(layer);
    await flush();

    expect(onError.mock.calls.map(([error]) => error.message)).toEqual([
      "Metadata loading failed in PlainLayer: PlainLayer can't open a source",
    ]);
  });
});
