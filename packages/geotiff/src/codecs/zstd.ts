import { decompress } from "fzstd";

export async function decode(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const result = decompress(new Uint8Array(bytes));
  return result.buffer as ArrayBuffer;
}
