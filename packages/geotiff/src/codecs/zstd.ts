import { decompress } from "fzstd";

export async function decode(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const result = decompress(new Uint8Array(bytes));
  return result.buffer.slice(
    result.byteOffset,
    result.byteOffset + result.byteLength,
  ) as ArrayBuffer;
}
