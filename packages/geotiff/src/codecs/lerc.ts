import { Compression } from "@cogeotiff/core";
import type { DecodedPixels, DecoderMetadata } from "../decode.js";
import { DECODER_REGISTRY } from "../decode.js";

/** Inner compression type encoded in LercParameters[1]. */
enum LercCompression {
  None = 0,
  Deflate = 1,
  Zstd = 2,
}

let wasmInitialized = false;

async function getLerc() {
  // This import is cached by the module loader
  const lerc = await import("lerc");

  if (!wasmInitialized) {
    await lerc.load();
    wasmInitialized = true;
  }

  return lerc;
}

export async function decode(
  bytes: ArrayBuffer,
  metadata: DecoderMetadata,
): Promise<DecodedPixels> {
  const compressionType: LercCompression =
    (metadata.lercParameters?.[1] as LercCompression | undefined) ??
    LercCompression.None;

  let lercInput: ArrayBuffer | Uint8Array = bytes;
  if (
    compressionType === LercCompression.Deflate ||
    compressionType === LercCompression.Zstd
  ) {
    const innerCompression =
      compressionType === LercCompression.Deflate
        ? Compression.Deflate
        : Compression.Zstd;
    const loader = DECODER_REGISTRY.get(innerCompression)!;
    const decoder = await loader();
    lercInput = (await decoder(bytes, metadata)) as ArrayBuffer;
  }

  const lerc = await getLerc();
  const result = lerc.decode(lercInput);
  return { layout: "band-separate", bands: result.pixels };
}
