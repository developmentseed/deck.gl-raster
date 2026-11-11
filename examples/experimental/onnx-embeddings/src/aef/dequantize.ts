import { DEQUANT_DIVISOR, NODATA_INT8, NUM_BANDS } from "./constants.js";

/**
 * Dequantized value of every int8, indexed by the value's unsigned byte
 * (`v & 0xff`): `(v / 127.5)² · sign(v)`.
 */
const DEQUANT_LUT = (() => {
  const lut = new Float32Array(256);
  for (let v = -128; v < 128; v++) {
    lut[v & 0xff] = (v * Math.abs(v)) / (DEQUANT_DIVISOR * DEQUANT_DIVISOR);
  }
  return lut;
})();

/** Dequantize one int8 value. */
export function dequantize(value: number): number {
  return DEQUANT_LUT[value & 0xff]!;
}

/**
 * Dequantize a whole `[64, height, width]` tile into `out`, which must have
 * the same length.
 */
export function dequantizeInto(embeddings: Int8Array, out: Float32Array): void {
  if (out.length !== embeddings.length) {
    throw new Error(
      `Expected an output of length ${embeddings.length}, got ${out.length}`,
    );
  }
  const bytes = new Uint8Array(
    embeddings.buffer,
    embeddings.byteOffset,
    embeddings.length,
  );
  for (let i = 0; i < bytes.length; i++) {
    out[i] = DEQUANT_LUT[bytes[i]!]!;
  }
}

/**
 * Read the dequantized 64-band vector of one pixel from a
 * `[64, height, width]` tile, or `null` if the pixel is nodata.
 */
export function readPixelVector(
  embeddings: Int8Array,
  height: number,
  width: number,
  row: number,
  col: number,
): Float32Array | null {
  const planeSize = height * width;
  const offset = row * width + col;
  if (embeddings[offset] === NODATA_INT8) {
    return null;
  }
  const vector = new Float32Array(NUM_BANDS);
  for (let band = 0; band < NUM_BANDS; band++) {
    vector[band] = dequantize(embeddings[band * planeSize + offset]!);
  }
  return vector;
}
