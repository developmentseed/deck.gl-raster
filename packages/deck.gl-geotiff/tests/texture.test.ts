import type { Device } from "@luma.gl/core";
import { describe, expect, it } from "vitest";
import { resolveTextureFormat } from "../src/geotiff/texture.js";

/** A device that can create every texture format, or none. */
function fakeDevice(supported: boolean): Device {
  return { isTextureFormatSupported: () => supported } as unknown as Device;
}

describe("resolveTextureFormat", () => {
  it("keeps a format the device supports, without copying the data", () => {
    const data = new Uint16Array([0, 65535, 1, 2]);
    const upload = resolveTextureFormat(fakeDevice(true), "rgba16unorm", data);
    expect(upload.format).toEqual("rgba16unorm");
    expect(upload.data).toBe(data);
  });

  it("swaps a 16-bit normalized format the device lacks for float32", () => {
    const upload = resolveTextureFormat(
      fakeDevice(false),
      "rgba16unorm",
      new Uint16Array([0, 65535, 32768, 1]),
    );
    expect(upload.format).toEqual("rgba32float");
    expect(upload.data).toEqual(
      new Float32Array([0, 1, 32768 / 65535, 1 / 65535]),
    );
  });
});
