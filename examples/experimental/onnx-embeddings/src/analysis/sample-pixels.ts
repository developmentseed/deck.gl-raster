import { NODATA_INT8, NUM_BANDS } from "../aef/constants.js";
import { dequantize } from "../aef/dequantize.js";
import type { AefTileData } from "../aef/get-tile-data.js";

/**
 * Sample up to `maxSamples` valid pixels, spread evenly over `tiles` on a
 * regular grid, and return their dequantized vectors, row-major.
 */
export function samplePixels(
  tiles: readonly AefTileData[],
  maxSamples: number,
): Float32Array {
  if (tiles.length === 0) {
    return new Float32Array(0);
  }
  const perTile = Math.max(1, Math.floor(maxSamples / tiles.length));
  const vectors: number[] = [];
  for (const tile of tiles) {
    const { embeddings, width, height } = tile;
    const planeSize = width * height;
    // A grid of at most `perTile` pixels
    const step = Math.max(1, Math.ceil(Math.sqrt(planeSize / perTile)));
    for (let row = Math.floor(step / 2); row < height; row += step) {
      for (let col = Math.floor(step / 2); col < width; col += step) {
        const offset = row * width + col;
        if (embeddings[offset] === NODATA_INT8) {
          continue;
        }
        for (let band = 0; band < NUM_BANDS; band++) {
          vectors.push(dequantize(embeddings[band * planeSize + offset]!));
        }
      }
    }
  }
  return Float32Array.from(vectors);
}
