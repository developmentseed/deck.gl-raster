import type {
  DecodedPixelInterleaved,
  RasterArray,
} from "@developmentseed/geotiff";
import type { Device } from "@luma.gl/core";
import { Texture } from "@luma.gl/core";
import { describe, expect, it, vi } from "vitest";
import { createBandTexture, MultiCOGLayer } from "../src/multi-cog-layer.js";

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

describe("createBandTexture", () => {
  // Hands back the texture props so the test can see the format and samples.
  const device = {
    createTexture: (props: unknown) => props,
  } as unknown as Device;
  const upload = (data: DecodedPixelInterleaved["data"]) =>
    createBandTexture(device, {
      layout: "pixel-interleaved",
      data,
      width: 2,
      height: 2,
      count: 1,
      nodata: null,
      mask: null,
      transform: [1, 0, 0, 0, -1, 0],
      crs: 4326,
    } satisfies RasterArray) as unknown as { data: unknown; format: string };

  it("uploads unsigned 8- and 16-bit samples as normalised formats", () => {
    const u8 = new Uint8Array(4);
    expect(upload(u8)).toMatchObject({ data: u8, format: "r8unorm" });
    const u16 = new Uint16Array(4);
    expect(upload(u16)).toMatchObject({ data: u16, format: "r16unorm" });
  });

  it("uploads signed integers as exact float32 samples", () => {
    const { data, format } = upload(new Int16Array([-999, -32768, 0, 32767]));
    expect(format).toBe("r32float");
    expect(data).toBeInstanceOf(Float32Array);
    expect(Array.from(data as Float32Array)).toEqual([-999, -32768, 0, 32767]);
  });

  it("uploads float32 as is and narrows float64", () => {
    const f32 = new Float32Array([0.5, -1, 2, 3]);
    expect(upload(f32)).toMatchObject({ data: f32, format: "r32float" });
    const { data } = upload(new Float64Array([0.5, -1, 2, 3]));
    expect(data).toBeInstanceOf(Float32Array);
    expect(Array.from(data as Float32Array)).toEqual([0.5, -1, 2, 3]);
  });

  it("rejects sample types it cannot upload", () => {
    expect(() => upload(new BigInt64Array(4) as never)).toThrow(
      "Unsupported typed array type: BigInt64Array.",
    );
  });
});
