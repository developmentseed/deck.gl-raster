import { decompressWithDecompressionStream } from "./decompression-stream.js";

export async function decode(bytes: Uint8Array): Promise<Uint8Array> {
  return decompressWithDecompressionStream(bytes, { format: "deflate" });
}
