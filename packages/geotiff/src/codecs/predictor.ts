import { PlanarConfiguration } from "@cogeotiff/core";
import { Predictor } from "../ifd.js";

/**
 * Undo TIFF horizontal differencing (predictor 2) or floating-point
 * prediction (predictor 3) in-place on a decoded tile buffer.
 *
 * Mirrors the applyPredictor logic in geotiff.js.
 */

/** Undo horizontal differencing for integer samples (predictor 2). */
function decodeRowAcc(row: Uint8Array | Uint16Array | Uint32Array, stride: number): void {
  const r = row as Uint32Array;
  let offset = 0;
  let length = row.length - stride;
  do {
    for (let i = stride; i > 0; i--) {
      r[offset + stride] = (r[offset + stride] ?? 0) + (r[offset] ?? 0);
      offset++;
    }
    length -= stride;
  } while (length > 0);
}

/** Undo floating-point horizontal differencing (predictor 3). */
function decodeRowFloatingPoint(row: Uint8Array, stride: number, bytesPerSample: number): void {
  let index = 0;
  let count = row.length;
  const wc = count / bytesPerSample;

  while (count > stride) {
    for (let i = stride; i > 0; i--) {
      row[index + stride]! += row[index]!;
      index++;
    }
    count -= stride;
  }

  const copy = row.slice();
  for (let i = 0; i < wc; i++) {
    for (let b = 0; b < bytesPerSample; b++) {
      row[bytesPerSample * i + b] = copy[(bytesPerSample - b - 1) * wc + i]!;
    }
  }
}

/**
 * Apply TIFF predictor decoding to a raw decoded tile buffer in-place.
 *
 * @param block              Decoded tile bytes.
 * @param predictor          Predictor enum value.
 * @param width              Tile width in pixels.
 * @param height             Tile height in pixels.
 * @param bitsPerSample      Bits per sample (all samples must be equal).
 * @param samplesPerPixel    Number of bands.
 * @param planarConfiguration  PlanarConfiguration enum value.
 */
export function applyPredictor(
  block: ArrayBuffer,
  predictor: Predictor,
  width: number,
  height: number,
  bitsPerSample: number,
  samplesPerPixel: number,
  planarConfiguration: PlanarConfiguration,
): ArrayBuffer {
  if (predictor === Predictor.None) {
    return block;
  }

  const bytesPerSample = bitsPerSample / 8;
  const stride = planarConfiguration === PlanarConfiguration.Separate ? 1 : samplesPerPixel;

  for (let i = 0; i < height; i++) {
    const byteOffset = i * stride * width * bytesPerSample;
    if (byteOffset >= block.byteLength) {
      break;
    }

    if (predictor === Predictor.Horizontal) {
      let row: Uint8Array | Uint16Array | Uint32Array;
      const length = stride * width;
      switch (bitsPerSample) {
        case 8:
          row = new Uint8Array(block, byteOffset, length);
          break;
        case 16:
          row = new Uint16Array(block, byteOffset, length);
          break;
        case 32:
          row = new Uint32Array(block, byteOffset, length);
          break;
        default:
          throw new Error(`Predictor 2 not supported for ${bitsPerSample} bits per sample.`);
      }
      decodeRowAcc(row, stride);
    } else if (predictor === Predictor.FloatingPoint) {
      const row = new Uint8Array(block, byteOffset, stride * width * bytesPerSample);
      decodeRowFloatingPoint(row, stride, bytesPerSample);
    }
  }

  return block;
}
