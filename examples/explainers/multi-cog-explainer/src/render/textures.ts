import type { RasterArray } from "@developmentseed/geotiff";
import type { Device, Texture } from "@luma.gl/core";

/** Fail early, with a clear message, on a GPU that can't do this. */
export function checkTextureSupport(
  device: Pick<Device, "isTextureFormatFilterable">,
): void {
  if (!device.isTextureFormatFilterable("r16unorm")) {
    throw new Error(
      "This GPU can't filter 16-bit textures (r16unorm), which this explainer needs.",
    );
  }
}

/**
 * Upload one band's array as a GPU texture, the way `MultiCOGLayer` uploads
 * 16-bit bands: `r16unorm` with linear filtering.
 */
export function createBandTexture(device: Device, array: RasterArray): Texture {
  if (array.layout !== "pixel-interleaved") {
    throw new Error("Expected a pixel-interleaved array");
  }
  return device.createTexture({
    data: array.data,
    format: "r16unorm",
    width: array.width,
    height: array.height,
    sampler: { minFilter: "linear", magFilter: "linear" },
  });
}
