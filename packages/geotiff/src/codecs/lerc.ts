import { Compression } from "@cogeotiff/core";
import type { LercData } from "lerc";
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
  const lercCompressionType: LercCompression =
    (metadata.lercParameters?.[1] as LercCompression | undefined) ??
    LercCompression.None;

  let lercInput: ArrayBuffer = bytes;
  if (
    lercCompressionType === LercCompression.Deflate ||
    lercCompressionType === LercCompression.Zstd
  ) {
    const innerCompression =
      lercCompressionType === LercCompression.Deflate
        ? Compression.Deflate
        : Compression.Zstd;
    const decoderEntry = DECODER_REGISTRY.get(innerCompression)!;
    const decoder = await decoderEntry();
    lercInput = (await decoder(bytes, metadata)) as ArrayBuffer;
  }

  const lerc = await getLerc();
  const result = lerc.decode(lercInput);
  if (result.pixelType === "F32" || result.pixelType === "F64") {
    setInvalidPixelsToNaN(result);
  }
  return { layout: "band-separate", bands: result.pixels };
}

/**
 * Set the float pixels that a LERC mask marks invalid to NaN, as libtiff does.
 *
 * LERC stores NaN as an invalid pixel in its mask rather than as a value, and
 * the decoder leaves invalid pixels at 0. Like libtiff, this runs before
 * samples from a big endian file are byte-swapped.
 */
function setInvalidPixelsToNaN(result: LercData): void {
  const { width, height, depthCount, pixels, mask, bandMasks } = result;
  const pixelCount = width * height;
  for (let b = 0; b < pixels.length; b++) {
    // Prefer the band's own mask: with one mask per band, `mask` marks a pixel
    // invalid wherever any band is.
    const bandMask = bandMasks?.[b] ?? mask;
    if (bandMask === null) {
      continue;
    }
    const band = pixels[b]!;
    for (let i = 0; i < pixelCount; i++) {
      if (bandMask[i] === 0) {
        // A band stores its depth values depth-major, so the values of one
        // pixel are `pixelCount` apart.
        for (let d = 0; d < depthCount; d++) {
          band[d * pixelCount + i] = Number.NaN;
        }
      }
    }
  }
}
