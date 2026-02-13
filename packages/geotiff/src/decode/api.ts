import { Compression, SampleFormat } from "@cogeotiff/core";
import type { RasterTypedArray } from "../array.js";

/** The result of a decoding process */
export type DecodedPixels =
  | { layout: "pixel-interleaved"; data: RasterTypedArray }
  | { layout: "band-separate"; bands: RasterTypedArray[] };

/** Metadata from the TIFF IFD, passed to decoders that need it. */
export type DecoderMetadata = {
  sampleFormat: SampleFormat;
  bitsPerSample: number;
  samplesPerPixel: number;
};

/**
 * A decoder returns either:
 * - An ArrayBuffer of raw decompressed bytes (byte-level codecs like deflate, zstd)
 * - A DecodedPixels with typed pixel data (image codecs like LERC, JPEG)
 */
export type Decoder = (
  bytes: ArrayBuffer,
  metadata: DecoderMetadata,
) => Promise<ArrayBuffer | DecodedPixels>;

async function decodeUncompressed(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  return bytes;
}

export const registry = new Map<Compression, () => Promise<Decoder>>();

registry.set(Compression.None, () => Promise.resolve(decodeUncompressed));
registry.set(Compression.Deflate, () =>
  import("../codecs/deflate.js").then((m) => m.decode),
);
registry.set(Compression.DeflateOther, () =>
  import("../codecs/deflate.js").then((m) => m.decode),
);
// registry.set(Compression.Zstd, () =>
//   import("../codecs/zstd.js").then((m) => m.decode),
// );
// registry.set(Compression.Lzma, () =>
//   import("../codecs/lzma.js").then((m) => m.decode),
// );
// registry.set(Compression.Webp, () =>
//   import("../codecs/webp.js").then((m) => m.decode),
// );
// registry.set(Compression.Jp2000, () =>
//   import("../codecs/jp2000.js").then((m) => m.decode),
// );
registry.set(Compression.Jpeg, () =>
  import("../codecs/jpeg.js").then((m) => m.decode),
);
registry.set(Compression.Lerc, () =>
  import("../codecs/lerc.js").then((m) => m.decode),
);

/**
 * Decode a tile's bytes according to its compression and image metadata.
 */
export async function decode(
  bytes: ArrayBuffer,
  compression: Compression,
  metadata: DecoderMetadata,
): Promise<DecodedPixels> {
  const loader = registry.get(compression);
  if (!loader) {
    throw new Error(`Unsupported compression: ${compression}`);
  }

  const decoder = await loader();
  const result = await decoder(bytes, metadata);

  if (result instanceof ArrayBuffer) {
    return {
      layout: "pixel-interleaved",
      data: toTypedArray(result, metadata),
    };
  }

  return result;
}

/**
 * Convert a raw ArrayBuffer of pixel data into a typed array based on the
 * sample format and bits per sample. This is used for codecs that return raw
 * bytes.
 */
function toTypedArray(
  buffer: ArrayBuffer,
  metadata: Pick<DecoderMetadata, "sampleFormat" | "bitsPerSample">,
): RasterTypedArray {
  const { sampleFormat, bitsPerSample } = metadata;
  switch (sampleFormat) {
    case SampleFormat.Uint:
      switch (bitsPerSample) {
        case 8:
          return new Uint8Array(buffer);
        case 16:
          return new Uint16Array(buffer);
        case 32:
          return new Uint32Array(buffer);
      }
      break;
    case SampleFormat.Int:
      switch (bitsPerSample) {
        case 8:
          return new Int8Array(buffer);
        case 16:
          return new Int16Array(buffer);
        case 32:
          return new Int32Array(buffer);
      }
      break;
    case SampleFormat.Float:
      switch (bitsPerSample) {
        case 32:
          return new Float32Array(buffer);
        case 64:
          return new Float64Array(buffer);
      }
      break;
  }
  throw new Error(
    `Unsupported sample format/depth: SampleFormat=${sampleFormat}, BitsPerSample=${bitsPerSample}`,
  );
}
