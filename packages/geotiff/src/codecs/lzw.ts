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

  // decompressed is a view over WebAssembly memory. In order to avoid problems
  // with memory management (especially around transferring the backing buffer,
  // which is actually the Wasm memory space), we copy the data into a fresh
  // Uint8Array
  const copy = new Uint8Array(decompressed.byteLength);
  copy.set(decompressed);
  return copy;
}
