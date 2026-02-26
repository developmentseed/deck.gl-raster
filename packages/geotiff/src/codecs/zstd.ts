import { decompress as fzstdDecompress } from "fzstd";

type ZstdDecompress = (bytes: Uint8Array) => Uint8Array;

let decompressFn: ZstdDecompress = fzstdDecompress;

/**
 * Set a custom zstd decompression function.
 *
 * By default, the pure-JavaScript `fzstd` library is used. Call this function
 * to override with a different implementation, e.g. `@hpcc-js/wasm-zstd`:
 *
 * ```ts
 * import { Zstd } from "@hpcc-js/wasm-zstd";
 * import { setZstdDecoder } from "@developmentseed/geotiff";
 *
 * const zstd = await Zstd.load();
 * setZstdDecoder((bytes) => zstd.decompress(bytes));
 * ```
 */
export function setZstdDecoder(decompress: ZstdDecompress): void {
  decompressFn = decompress;
}

export async function decode(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const result = decompressFn(new Uint8Array(bytes));
  return result.buffer as ArrayBuffer;
}
