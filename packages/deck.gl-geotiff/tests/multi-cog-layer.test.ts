import { Texture } from "@luma.gl/core";
import { describe, expect, it, vi } from "vitest";
import { MultiCOGLayer } from "../src/multi-cog-layer.js";

function fakeTexture(): {
  texture: Texture;
  destroy: ReturnType<typeof vi.fn>;
} {
  const destroy = vi.fn();
  const texture = Object.create(Texture.prototype) as Texture;
  Object.defineProperty(texture, "destroy", { value: destroy });
  return { texture, destroy };
}

function unloadCallback(layer: MultiCOGLayer) {
  return (
    layer as unknown as {
      _onTileUnloadCallback: () =>
        | ((tile: { content: unknown }) => void)
        | undefined;
    }
  )._onTileUnloadCallback();
}

describe("MultiCOGLayer._onTileUnloadCallback", () => {
  it("destroys every band texture and calls the user callback", () => {
    const userCalls: unknown[] = [];
    const layer = new MultiCOGLayer({
      id: "multi",
      sources: {},
      onTileUnload: (tile: unknown) => userCalls.push(tile),
    } as never);

    const cb = unloadCallback(layer);
    expect(cb).toBeTypeOf("function");

    const texA = fakeTexture();
    const texB = fakeTexture();
    const bands = new Map([
      ["a", { texture: texA.texture }],
      ["b", { texture: texB.texture }],
    ]);
    const tile = { content: { bands } };
    cb?.(tile);

    expect(texA.destroy).toHaveBeenCalledOnce();
    expect(texB.destroy).toHaveBeenCalledOnce();
    expect(userCalls).toEqual([tile]);
  });

  it("tolerates a tile with no data", () => {
    const layer = new MultiCOGLayer({ id: "multi", sources: {} } as never);
    const cb = unloadCallback(layer);
    expect(() => cb?.({ content: null })).not.toThrow();
  });
});

describe("MultiCOGLayer.updateState", () => {
  it("raises a COG open failure through onError", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = new MultiCOGLayer({
      id: "multi",
      sources: { a: { url: "https://example.com/a.tif" } },
      onError,
    } as never);
    vi.spyOn(layer, "setState").mockImplementation(() => {});
    vi.spyOn(layer, "_parseAllSources").mockRejectedValue(new Error("boom"));

    layer.updateState({
      props: layer.props,
      oldProps: layer.props,
      changeFlags: { dataChanged: true },
    } as never);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    const error = onError.mock.calls[0]?.[0];
    expect(error?.message).toBe("loading COG sources: boom");
    expect(error?.cause).toBeInstanceOf(Error);
  });
});
