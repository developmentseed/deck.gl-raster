import { decompress } from "fzstd";
import { copyIfViewNotFullBuffer } from "./utils.js";

export async function decode(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const result = decompress(new Uint8Array(bytes));
  return copyIfViewNotFullBuffer(result);
}
