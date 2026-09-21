import { describe, expect, it, vi } from "vitest";
import { ZarrLayer } from "../src/zarr-layer.js";

/**
 * Build a ZarrLayer detached from the deck.gl lifecycle.
 *
 * `state` is normally assigned during layer matching; `setState` needs it to be
 * an object, and every other lifecycle hook it touches is guarded on
 * `internalState`, which stays null here.
 */
function makeLayer(onError: (error: Error) => boolean) {
  const layer = new ZarrLayer({
    id: "zarr",
    node: { attrs: {}, resolve: () => ({}) },
    onError,
  } as never);
  layer.state = {} as never;
  return layer;
}

/** Drive the `needsUpdate` branch of `updateState`. */
function triggerUpdate(layer: ZarrLayer) {
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: { dataChanged: true },
  } as never);
}

describe("ZarrLayer.updateState", () => {
  it("raises a Zarr open failure through onError", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = makeLayer(onError);
    vi.spyOn(layer, "_parseZarr").mockRejectedValue(new Error("boom"));

    triggerUpdate(layer);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0]?.[0]?.message).toBe("loading Zarr: boom");
  });

  it("normalizes a rejection value that is not an Error", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = makeLayer(onError);
    vi.spyOn(layer, "_parseZarr").mockRejectedValue("just a string");

    triggerUpdate(layer);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0]?.[0]?.message).toBe(
      "loading Zarr: just a string",
    );
  });

  it("drops a rejection that arrives after the layer is finalized", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = makeLayer(onError);
    let rejectParse: (error: Error) => void = () => {};
    vi.spyOn(layer, "_parseZarr").mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectParse = reject;
      }),
    );

    triggerUpdate(layer);
    layer.finalizeState(null as never);
    rejectParse(new Error("boom"));

    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it("drops a rejection from a parse superseded by a newer update", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = makeLayer(onError);
    let rejectFirst: (error: Error) => void = () => {};
    vi.spyOn(layer, "_parseZarr")
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
      )
      .mockReturnValueOnce(new Promise(() => {}));

    triggerUpdate(layer);
    triggerUpdate(layer);
    rejectFirst(new Error("stale"));

    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });
});
