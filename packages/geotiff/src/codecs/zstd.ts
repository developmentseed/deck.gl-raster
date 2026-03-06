import { decompress } from "fzstd";
import { copyIfViewNotFullBuffer } from "./utils";

export async function decode(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const result = decompress(new Uint8Array(bytes));
  return copyIfViewNotFullBuffer(result);
}
