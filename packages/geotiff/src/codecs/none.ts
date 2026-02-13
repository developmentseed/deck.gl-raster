import type { DecodedPixels } from "../decode/api.js";

export async function decode(bytes: ArrayBuffer): Promise<DecodedPixels> {
  return { layout: "pixel-interleaved", data: new Uint8Array(bytes) };
}
