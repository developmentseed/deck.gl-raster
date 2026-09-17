import type { RasterArrayPixelInterleaved } from "@developmentseed/geotiff";
import { Texture } from "@luma.gl/core";
import { describe, expect, it, vi } from "vitest";
import {
  fillPaddingWithNodata,
  MultiCOGLayer,
} from "../src/multi-cog-layer.js";

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

/** A single-band, pixel-interleaved tile of `7`s with a nodata of -999. */
function tile(
  width: number,
  height: number,
  count = 1,
  nodata: number | null = -999,
): RasterArrayPixelInterleaved {
  return {
    layout: "pixel-interleaved",
    data: new Int16Array(width * height * count).fill(7),
    width,
    height,
    count,
    nodata,
    mask: null,
    transform: [1, 0, 0, 0, -1, 0],
    crs: 4326,
  };
}

describe("fillPaddingWithNodata", () => {
  // A 6x6 image on 4x4 tiles: tile (1, 1) holds a 2x2 corner of data.
  const image = { width: 6, height: 6, tileWidth: 4, tileHeight: 4 } as never;

  it("rewrites the columns and rows past the image bounds", () => {
    const edge = tile(4, 4);
    expect(fillPaddingWithNodata(image, 1, 1, edge)).toBe(edge);
    expect(Array.from(edge.data)).toEqual([
      ...[7, 7, -999, -999],
      ...[7, 7, -999, -999],
      ...[-999, -999, -999, -999],
      ...[-999, -999, -999, -999],
    ]);
  });

  it("fills every sample of a multi-band pixel", () => {
    const edge = tile(4, 1, 2);
    fillPaddingWithNodata(
      { width: 6, height: 1, tileWidth: 4, tileHeight: 1 } as never,
      1,
      0,
      edge,
    );
    expect(Array.from(edge.data)).toEqual([
      ...[7, 7, 7, 7],
      ...[-999, -999, -999, -999],
    ]);
  });

  it("leaves interior tiles and unstamped images untouched", () => {
    const interior = tile(4, 4);
    fillPaddingWithNodata(image, 0, 0, interior);
    expect(new Set(interior.data)).toEqual(new Set([7]));

    const unstamped = tile(4, 4, 1, null);
    fillPaddingWithNodata(image, 1, 1, unstamped);
    expect(new Set(unstamped.data)).toEqual(new Set([7]));
  });
});
