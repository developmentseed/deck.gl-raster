/**
 * Assembly of a one-texel "halo" around a tile's elevation data.
 *
 * Hillshade needs a 3×3 neighborhood per pixel, but a tile's texture holds
 * only that tile's texels. At the tile border the ±1 tap falls outside the
 * texture and `CLAMP_TO_EDGE` returns the border texel itself, halving the
 * computed gradient — a visible seam grid along every tile boundary.
 *
 * The fix is to upload a `(tileWidth + 2) × (tileHeight + 2)` texture whose
 * outermost ring is copied from the eight neighboring tiles.
 */

/** Number of entries in a 3×3 neighbor grid. */
const NEIGHBOR_GRID_SIZE = 9;

/** Index of the center tile within a row-major 3×3 neighbor grid. */
export const CENTER_INDEX = 4;

/**
 * Row-major index into a 3×3 neighbor grid for the tile offset `(dx, dy)`,
 * where each component is `-1`, `0`, or `1`. The center tile is
 * {@link CENTER_INDEX}.
 *
 * @param dx - Column offset from the center tile.
 * @param dy - Row offset from the center tile.
 */
export function neighborIndex(dx: number, dy: number): number {
  return (dy + 1) * 3 + (dx + 1);
}

/** Inputs to {@link buildHaloArray}. */
export interface BuildHaloArrayOptions {
  /**
   * The 3×3 grid of tile sample arrays in row-major order (see
   * {@link neighborIndex}), each of length `tileWidth * tileHeight`.
   *
   * Index {@link CENTER_INDEX} is the tile being assembled and is required.
   * Any other entry may be `null`, meaning that neighbor lies outside the
   * image; the center tile's own edge is replicated there instead, matching
   * `gdaldem` behavior at raster edges.
   */
  tiles: ReadonlyArray<Float32Array | null>;
  /** Width of a single tile in pixels. */
  tileWidth: number;
  /** Height of a single tile in pixels. */
  tileHeight: number;
}

/**
 * Build a `(tileWidth + 2) × (tileHeight + 2)` array: the center tile inset by
 * one texel, ringed by one texel of its neighbors' data.
 *
 * @param options - The neighbor grid and tile dimensions.
 * @returns The padded sample array, row-major.
 * @throws If the center tile is missing or any supplied tile has the wrong
 *   length.
 */
export function buildHaloArray(options: BuildHaloArrayOptions): Float32Array {
  const { tiles, tileWidth, tileHeight } = options;

  if (tiles.length !== NEIGHBOR_GRID_SIZE) {
    throw new Error(
      `Expected ${NEIGHBOR_GRID_SIZE} neighbor slots, got ${tiles.length}`,
    );
  }

  const center = tiles[CENTER_INDEX];
  if (!center) {
    throw new Error("The center tile is required to build a halo array");
  }

  const tileLength = tileWidth * tileHeight;
  for (const [i, tile] of tiles.entries()) {
    if (tile && tile.length !== tileLength) {
      throw new Error(
        `Neighbor ${i} has length ${tile.length}, expected ${tileLength}`,
      );
    }
  }

  const paddedWidth = tileWidth + 2;
  const paddedHeight = tileHeight + 2;
  const out = new Float32Array(paddedWidth * paddedHeight);

  // Interior: blit the center tile row by row, inset by one texel. This is
  // all but the outermost ring, so it is worth doing with `set` rather than
  // through the general per-pixel path below.
  for (let row = 0; row < tileHeight; row++) {
    const sourceRow = center.subarray(row * tileWidth, (row + 1) * tileWidth);
    out.set(sourceRow, (row + 1) * paddedWidth + 1);
  }

  /**
   * Read the sample at `(x, y)` in the center tile's coordinate space, where
   * coordinates outside `[0, tileWidth) × [0, tileHeight)` resolve into a
   * neighboring tile — or, if that neighbor is absent, clamp to the center
   * tile's edge.
   */
  const sample = (x: number, y: number): number => {
    const dx = x < 0 ? -1 : x >= tileWidth ? 1 : 0;
    const dy = y < 0 ? -1 : y >= tileHeight ? 1 : 0;
    const neighbor = tiles[neighborIndex(dx, dy)];

    if (!neighbor) {
      const clampedX = Math.min(Math.max(x, 0), tileWidth - 1);
      const clampedY = Math.min(Math.max(y, 0), tileHeight - 1);
      return center[clampedY * tileWidth + clampedX]!;
    }

    return neighbor[(y - dy * tileHeight) * tileWidth + (x - dx * tileWidth)]!;
  };

  // Ring: the top and bottom rows in full, then the left and right columns of
  // every interior row.
  for (let x = 0; x < paddedWidth; x++) {
    out[x] = sample(x - 1, -1);
    out[(paddedHeight - 1) * paddedWidth + x] = sample(x - 1, tileHeight);
  }
  for (let row = 0; row < tileHeight; row++) {
    const outRow = row + 1;
    out[outRow * paddedWidth] = sample(-1, row);
    out[outRow * paddedWidth + paddedWidth - 1] = sample(tileWidth, row);
  }

  return out;
}
