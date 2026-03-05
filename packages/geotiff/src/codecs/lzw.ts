import { decompress } from "@developmentseed/lzw-tiff-decoder";
import type { DecoderMetadata } from "../decode.js";
import { copyIfNeeded } from "./utils.js";

export async function decode(
  bytes: ArrayBuffer | Uint8Array,
  metadata: DecoderMetadata,
): Promise<ArrayBuffer> {
  const { width, height, samplesPerPixel, bitsPerSample } = metadata;
  const maxUncompressedSize =
    width * height * samplesPerPixel * (bitsPerSample / 8);
  const decompressed = decompress(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    maxUncompressedSize,
  );

  return copyIfNeeded(decompressed);
}
