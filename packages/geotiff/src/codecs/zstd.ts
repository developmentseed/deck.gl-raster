import { decompress } from "fzstd";

export async function decode(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  return decompress(new Uint8Array(bytes)).buffer as ArrayBuffer;
}
