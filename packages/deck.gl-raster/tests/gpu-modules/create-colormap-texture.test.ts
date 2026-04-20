import type { Device, Texture, TextureProps } from "@luma.gl/core";
import { describe, expect, it, vi } from "vitest";
import { createColormapTexture } from "../../src/gpu-modules/create-colormap-texture.js";

function makeImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    data[i] = i & 0xff;
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

function makeMockDevice(): {
  device: Device;
  createTexture: ReturnType<typeof vi.fn>;
} {
  const createTexture = vi.fn((props: TextureProps): Texture => {
    return { id: "cmap-sprite", props } as unknown as Texture;
  });
  const device = { createTexture } as unknown as Device;
  return { device, createTexture };
}

describe("createColormapTexture", () => {
  it("creates a 2D-array texture with the image's dimensions", () => {
    const { device, createTexture } = makeMockDevice();
    const imageData = makeImageData(256, 3);

    createColormapTexture(device, imageData);

    expect(createTexture).toHaveBeenCalledTimes(1);
    const props = createTexture.mock.calls[0]![0] as TextureProps;
    expect(props.dimension).toBe("2d-array");
    expect(props.format).toBe("rgba8unorm");
    expect(props.width).toBe(256);
    expect(props.height).toBe(1);
    expect(props.depth).toBe(3);
  });

  it("returns the Texture produced by device.createTexture", () => {
    const { device, createTexture } = makeMockDevice();
    const imageData = makeImageData(256, 2);

    const result = createColormapTexture(device, imageData);

    expect(result).toBe(createTexture.mock.results[0]!.value);
  });

  it("throws when the ImageData width is not 256", () => {
    const { device } = makeMockDevice();
    const imageData = makeImageData(128, 3);

    expect(() => createColormapTexture(device, imageData)).toThrow(/256/);
  });

  it("passes the ImageData bytes straight through as the texture data", () => {
    const { device, createTexture } = makeMockDevice();
    const imageData = makeImageData(256, 2);

    createColormapTexture(device, imageData);

    const props = createTexture.mock.calls[0]![0] as TextureProps;
    const bytes = props.data as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(256 * 2 * 4);
    expect(bytes[0]).toBe(0);
    expect(bytes[bytes.byteLength - 1]).toBe(255);
  });
});
