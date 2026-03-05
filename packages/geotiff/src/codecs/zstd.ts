import { decompress } from "fzstd";

export async function decode(bytes: Uint8Array): Promise<Uint8Array> {
  return decompress(bytes);
}
