import { decompress } from "@developmentseed/lzw-tiff-decoder";
import type { DecoderMetadata } from "../decode.js";

export async function decode(
  bytes: Uint8Array,
  metadata: DecoderMetadata,
): Promise<Uint8Array> {
  const { width, height, samplesPerPixel, bitsPerSample } = metadata;
  const maxUncompressedSize =
    width * height * samplesPerPixel * (bitsPerSample / 8);
  const decompressed = decompress(bytes, maxUncompressedSize);

  // Note: decompressed is **not** a view over WebAssembly memory. wasm-bindgen
  // has already copied out of Rust memory into JS
  return decompressed;
}
