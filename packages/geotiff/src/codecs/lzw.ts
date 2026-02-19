import { decompress } from "@developmentseed/lzw-tiff-decoder";
import type { DecoderMetadata } from "../decode.js";

export async function decode(
  bytes: ArrayBuffer,
  metadata: DecoderMetadata,
): Promise<ArrayBuffer> {
  const { width, height, samplesPerPixel, bitsPerSample } = metadata;
  const maxUncompressedSize =
    width * height * samplesPerPixel * (bitsPerSample / 8);
  const result = decompress(new Uint8Array(bytes), maxUncompressedSize);
  return result.buffer.slice(
    result.byteOffset,
    result.byteOffset + result.byteLength,
  ) as ArrayBuffer;
}
