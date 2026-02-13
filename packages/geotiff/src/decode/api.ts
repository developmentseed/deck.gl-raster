import { Compression, SampleFormat } from "@cogeotiff/core";
import type { RasterTypedArray } from "../array.js";

/** The result of a decoding process */
export type DecodedPixels =
  | { layout: "pixel-interleaved"; data: RasterTypedArray }
  | { layout: "band-separate"; bands: RasterTypedArray[] };

/**
 * A decoder returns either:
 * - An ArrayBuffer of raw decompressed bytes (byte-level codecs like deflate, zstd)
 * - A DecodedPixels with typed pixel data (image codecs like LERC, JPEG)
 */
export type Decoder = (
  bytes: ArrayBuffer,
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
// registry.set(Compression.Jpeg, () =>
//   import("../codecs/jpeg.js").then((m) => m.decode),
// );
// registry.set(Compression.Jpeg6, () =>
//   import("../codecs/jpeg.js").then((m) => m.decode),
// );
registry.set(Compression.Lerc, () =>
  import("../codecs/lerc.js").then((m) => m.decode),
);

/**
 * Decode a tile's bytes according to its compression and image metadata.
 */
export async function decode(
  bytes: ArrayBuffer,
  compression: Compression,
  {
    sampleFormat,
    bitsPerSample,
  }: {
    sampleFormat: SampleFormat;
    bitsPerSample: number;
  },
): Promise<DecodedPixels> {
  const loader = registry.get(compression);
  if (!loader) {
    throw new Error(`Unsupported compression: ${compression}`);
  }

  const decoder = await loader();
  const result = await decoder(bytes);

  if (result instanceof ArrayBuffer) {
    return {
      layout: "pixel-interleaved",
      data: toTypedArray(result, sampleFormat, bitsPerSample),
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
  sampleFormat: SampleFormat,
  bitsPerSample: number,
): RasterTypedArray {
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
