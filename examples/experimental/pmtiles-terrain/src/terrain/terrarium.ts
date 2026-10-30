/**
 * Decode Terrarium-encoded RGBA pixels to elevations in meters.
 *
 * Terrarium packs each elevation into the red, green and blue bytes:
 * `elevation = R * 256 + G + B / 256 - 32768`. Alpha carries nothing. With
 * the bytes as integers every step is exact in a 32-bit float: the largest
 * sum, 65535.996, needs 24 bits.
 *
 * @param rgba - Interleaved RGBA bytes, four per pixel.
 * @returns One elevation per pixel, in the pixels' order.
 */
export function terrariumToElevation(
  rgba: Uint8Array | Uint8ClampedArray,
): Float32Array {
  const elevation = new Float32Array(rgba.length / 4);
  for (let i = 0; i < elevation.length; i++) {
    const offset = i * 4;
    elevation[i] =
      rgba[offset]! * 256 + rgba[offset + 1]! + rgba[offset + 2]! / 256 - 32768;
  }
  return elevation;
}
