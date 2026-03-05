import { decompressWithDecompressionStream } from "./decompression-stream.js";

export async function decode(
  bytes: ArrayBuffer | Uint8Array,
): Promise<ArrayBuffer> {
  return decompressWithDecompressionStream(bytes, { format: "deflate" });
}
