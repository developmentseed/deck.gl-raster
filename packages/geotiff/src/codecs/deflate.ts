import type { DecodedPixels } from "../decode/api.js";
import { decompressWithDecompressionStream } from "./decompression-stream.js";

export async function decode(bytes: ArrayBuffer): Promise<DecodedPixels> {
  const result = await decompressWithDecompressionStream(bytes, {
    format: "deflate",
  });
  return { layout: "pixel-interleaved", data: new Uint8Array(result) };
}
