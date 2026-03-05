import { decompressWithDecompressionStream } from "./decompression-stream.js";

export async function decode(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  return decompressWithDecompressionStream(bytes, { format: "deflate" });
}
