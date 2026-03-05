import type { PlanarConfiguration, Predictor } from "@cogeotiff/core";
import { Compression, SampleFormat } from "@cogeotiff/core";
import type { RasterTypedArray } from "./array.js";
import { decode as decodeViaCanvas } from "./codecs/canvas.js";
import { applyPredictor } from "./codecs/predictor.js";

/** Raster stored in one pixel-interleaved typed array. */
export type DecodedPixelInterleaved = {
  layout: "pixel-interleaved";
  /**
   * Pixel-interleaved raster data:
   * [p00_band0, p00_band1, ..., p01_band0, ...]
   *
   * Length = width * height * count.
   */
  data: RasterTypedArray;
};

/** Raster stored in one typed array per band (band-major / planar). */
export type DecodedBandSeparate = {
  layout: "band-separate";
  /**
   * One typed array per band, each length = width * height.
   *
   * This is the preferred representation when uploading one texture per band.
   */
  bands: RasterTypedArray[];
};

/** The result of a decoding process */
export type DecodedPixels = DecodedPixelInterleaved | DecodedBandSeparate;

/** Metadata from the TIFF IFD, passed to decoders that need it. */
export type DecoderMetadata = {
  sampleFormat: SampleFormat;
  bitsPerSample: number;
  samplesPerPixel: number;
  width: number;
  height: number;
  predictor: Predictor;
  planarConfiguration: PlanarConfiguration;
};

/**
 * A decoder returns either:
 * - An ArrayBuffer of raw decompressed bytes (byte-level codecs like deflate, zstd)
 * - A DecodedPixels with typed pixel data (image codecs like LERC, JPEG)
 */
export type Decoder = (
  bytes: Uint8Array,
  metadata: DecoderMetadata,
) => Promise<Uint8Array | DecodedPixels>;

async function decodeUncompressed(bytes: Uint8Array): Promise<Uint8Array> {
  return bytes;
}

export const DECODER_REGISTRY = new Map<Compression, () => Promise<Decoder>>();

DECODER_REGISTRY.set(Compression.None, () =>
  Promise.resolve(decodeUncompressed),
);
DECODER_REGISTRY.set(Compression.Deflate, () =>
  import("./codecs/deflate.js").then((m) => m.decode),
);
DECODER_REGISTRY.set(Compression.DeflateOther, () =>
  import("./codecs/deflate.js").then((m) => m.decode),
);
DECODER_REGISTRY.set(Compression.Lzw, () =>
  import("./codecs/lzw.js").then((m) => m.decode),
);
DECODER_REGISTRY.set(Compression.Zstd, () =>
  import("./codecs/zstd.js").then((m) => m.decode),
);
// DECODER_REGISTRY.set(Compression.Lzma, () =>
//   import("../codecs/lzma.js").then((m) => m.decode),
// );
// DECODER_REGISTRY.set(Compression.Jp2000, () =>
//   import("../codecs/jp2000.js").then((m) => m.decode),
// );
DECODER_REGISTRY.set(Compression.Jpeg, () => Promise.resolve(decodeViaCanvas));
DECODER_REGISTRY.set(Compression.Jpeg6, () => Promise.resolve(decodeViaCanvas));
DECODER_REGISTRY.set(Compression.Webp, () => Promise.resolve(decodeViaCanvas));
DECODER_REGISTRY.set(Compression.Lerc, () =>
  import("./codecs/lerc.js").then((m) => m.decode),
);

/**
 * Decode a tile's bytes according to its compression and image metadata.
 */
export async function decode(
  bytes: Uint8Array,
  compression: Compression,
  metadata: DecoderMetadata,
): Promise<DecodedPixels> {
  const loader = DECODER_REGISTRY.get(compression);
  if (!loader) {
    throw new Error(`Unsupported compression: ${compression}`);
  }

  const decoder = await loader();
  const result = await decoder(bytes, metadata);

  if (result instanceof Uint8Array) {
    const {
      predictor,
      width,
      height,
      bitsPerSample,
      samplesPerPixel,
      planarConfiguration,
    } = metadata;
    const predicted = applyPredictor(
      result,
      predictor,
      width,
      height,
      bitsPerSample,
      samplesPerPixel,
      planarConfiguration,
    );
    return {
      layout: "pixel-interleaved",
      data: toTypedArray(predicted, metadata),
    };
  }

  return result;
}

/**
 * Unpack a 1-bit packed mask buffer (MSB-first) into a Uint8Array of 0/255.
 * Each input byte holds 8 pixels; bit 7 is the first pixel in that byte.
 */
// TODO: check for FillOrder tag and reverse bit order if needed
// https://web.archive.org/web/20240329145342/https://www.awaresystems.be/imaging/tiff/tifftags/fillorder.html
export function unpackBitPacked(
  packed: Uint8Array,
  pixelCount: number,
): Uint8Array {
  const out = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    out[i] = (packed[i >> 3]! >> (7 - (i & 7))) & 1 ? 255 : 0;
  }
  return out;
}

/**
 * Convert raw pixel data into a typed array based on the sample format and bits
 * per sample. This is used for codecs that return raw bytes.
 */
function toTypedArray(
  buffer: Uint8Array,
  metadata: DecoderMetadata,
): RasterTypedArray {
  const { sampleFormat, bitsPerSample } = metadata;
  switch (sampleFormat) {
    case SampleFormat.Uint:
      switch (bitsPerSample) {
        case 1:
          return unpackBitPacked(
            buffer,
            metadata.width * metadata.height * metadata.samplesPerPixel,
          );
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
