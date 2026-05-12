import type { Device, Texture } from "@luma.gl/core";

/**
 * Build the 256-entry boolean lookup table consumed by `FilterCategory`.
 *
 * Returns a `Uint8Array(256)` with byte 255 at every selected code and 0
 * elsewhere. Codes outside the 0–255 range are silently ignored.
 */
export function buildFilterLUT(selected: Set<number>): Uint8Array {
  const lut = new Uint8Array(256);
  for (const code of selected) {
    if (code >= 0 && code <= 255) {
      lut[code] = 255;
    }
  }
  return lut;
}

/**
 * Create a 256×1 `r8unorm` texture from a filter LUT byte array. Sampled
 * with `texelFetch`, so the sampler filter is set to nearest defensively.
 */
export function createFilterLUTTexture(
  device: Device,
  lut: Uint8Array,
): Texture {
  return device.createTexture({
    data: lut,
    format: "r8unorm",
    width: 256,
    height: 1,
    sampler: {
      minFilter: "nearest",
      magFilter: "nearest",
    },
  });
}
