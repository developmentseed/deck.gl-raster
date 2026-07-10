import type { Device, Texture } from "@luma.gl/core";

/**
 * Upload a decoded colormap sprite to the GPU as a 2D array texture.
 *
 * The image must be exactly 256 pixels wide; each row becomes one layer
 * of the returned `Texture` (`dimension: "2d-array"`, `format:
 * "rgba8unorm"`). Use the result as the `colormapTexture` prop of the
 * `Colormap` shader module.
 *
 * Synchronous — pair with `decodeColormapSprite` when you have a URL or
 * raw bytes rather than an already-decoded `ImageData`.
 *
 * @throws when `imageData.width` is not 256.
 */
export function createColormapTexture(
  device: Device,
  imageData: ImageData,
): Texture {
  if (imageData.width !== 256) {
    throw new Error(
      `Expected a 256-pixel-wide colormap sprite, got width ${imageData.width}.`,
    );
  }
  // ImageData row-major layout (RGBA row 0, RGBA row 1, …) matches luma.gl's
  // 2D-array upload layout (layer-major). Each layer is one image row and
  // exactly one texel tall, so no re-packing is needed.
  const bytes = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  );
  return device.createTexture({
    dimension: "2d-array",
    format: "rgba8unorm",
    width: 256,
    height: 1,
    depth: imageData.height,
    data: bytes,
    mipLevels: 1,
    sampler: {
      minFilter: "linear",
      magFilter: "linear",
      // Clamp in every axis so an out-of-range colormapIndex yields an
      // edge color rather than wrapping to an unrelated colormap.
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      addressModeW: "clamp-to-edge",
    },
  });
}
