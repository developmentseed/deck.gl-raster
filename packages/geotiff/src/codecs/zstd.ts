import { decompress } from "fzstd";
import { copyIfNeeded } from "./utils";

export async function decode(
  bytes: ArrayBuffer | Uint8Array,
): Promise<ArrayBuffer> {
  const decompressed = decompress(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  );
  return copyIfNeeded(decompressed);
}
