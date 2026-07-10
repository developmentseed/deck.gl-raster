import type { RasterArray, RasterTypedArray } from "./array.js";
import type { Tile } from "./tile.js";

/**
 * Options for {@link assembleTiles}.
 */
export interface AssembleTilesOptions {
  /** Total output width in pixels. */
  width: number;
  /** Total output height in pixels. */
  height: number;
  /** Tile width in pixels (all tiles must share this). */
  tileWidth: number;
  /** Tile height in pixels (all tiles must share this). */
  tileHeight: number;
  /** Column index of the leftmost tile in the grid. */
  minCol: number;
  /** Row index of the topmost tile in the grid. */
  minRow: number;
}

/**
 * Assemble multiple fetched tiles into a single {@link RasterArray}.
 *
 * Handles both pixel-interleaved and band-separate layouts, preserving the
 * original typed array type (e.g. `Float32Array`, `Uint16Array`). Masks are
 * assembled alongside data when present.
 *
 * The output array's `transform`, `crs`, and `nodata` are taken from the
 * top-left tile (the tile at `(minCol, minRow)`).
 *
 * @param tiles - Fetched tiles to assemble. Must form a contiguous rectangular
 *   grid and all share the same layout, band count, and typed array type.
 * @param opts - Describes the output grid dimensions and tile positions.
 * @returns A single {@link RasterArray} containing the assembled data.
 *
 * @see {@link AssembleTilesOptions}
 */
export function assembleTiles(
  tiles: Tile[],
  opts: AssembleTilesOptions,
): RasterArray {
  validateContiguousGrid(tiles, opts);

  const { width, height, tileWidth, tileHeight, minCol, minRow } = opts;
  const firstArray = tiles[0]!.array;
  const { count, crs, nodata } = firstArray;

  // Find the top-left tile for transform reference
  const topLeftTile =
    tiles.find((t) => t.x === minCol && t.y === minRow) ?? tiles[0]!;

  // Determine if any tile has a mask
  const hasMask = tiles.some((t) => t.array.mask !== null);

  // Assemble mask if needed
  let outputMask: Uint8Array | null = null;
  if (hasMask) {
    outputMask = new Uint8Array(width * height);
    for (const tile of tiles) {
      const colOffset = (tile.x - minCol) * tileWidth;
      const rowOffset = (tile.y - minRow) * tileHeight;
      const srcMask = tile.array.mask;
      if (srcMask === null) {
        // No mask on this tile — fill with 255 (all valid)
        fillRows(outputMask, {
          dstWidth: width,
          colOffset,
          rowOffset,
          fillWidth: tile.array.width,
          fillHeight: tile.array.height,
          value: 255,
        });
      } else {
        copyRows(srcMask, outputMask, {
          srcWidth: tile.array.width,
          dstWidth: width,
          colOffset,
          rowOffset,
          copyWidth: tile.array.width,
          copyHeight: tile.array.height,
          samplesPerPixel: 1,
        });
      }
    }
  }

  const arrayMeta = {
    count,
    transform: topLeftTile.array.transform,
    crs,
    nodata,
    mask: outputMask,
  };

  if (firstArray.layout === "pixel-interleaved") {
    return assemblePixelInterleaved(tiles, opts, arrayMeta);
  }

  return assembleBandSeparate(tiles, opts, arrayMeta);
}

/** Metadata carried from the source tiles into the assembled output. */
interface ArrayMeta {
  count: number;
  transform: RasterArray["transform"];
  crs: RasterArray["crs"];
  nodata: RasterArray["nodata"];
  mask: Uint8Array | null;
}

/**
 * Assemble pixel-interleaved tiles into a single pixel-interleaved
 * {@link RasterArray}.
 */
function assemblePixelInterleaved(
  tiles: Tile[],
  opts: AssembleTilesOptions,
  meta: ArrayMeta,
): RasterArray {
  const { width, height, tileWidth, tileHeight, minCol, minRow } = opts;
  const { count, transform, crs, nodata, mask } = meta;
  const firstArray = tiles[0]!.array;

  if (firstArray.layout !== "pixel-interleaved") {
    throw new Error("Expected pixel-interleaved layout");
  }

  // Allocate output with the same typed array type as the input
  const Ctor = firstArray.data.constructor as new (
    length: number,
  ) => RasterTypedArray;
  const outputData = new Ctor(width * height * count);

  for (const tile of tiles) {
    const { array } = tile;
    if (array.layout !== "pixel-interleaved") {
      throw new Error(
        "All tiles must have the same layout; expected pixel-interleaved",
      );
    }

    const colOffset = (tile.x - minCol) * tileWidth;
    const rowOffset = (tile.y - minRow) * tileHeight;

    copyRows(array.data, outputData, {
      srcWidth: array.width,
      dstWidth: width,
      colOffset,
      rowOffset,
      copyWidth: array.width,
      copyHeight: array.height,
      samplesPerPixel: count,
    });
  }

  return {
    layout: "pixel-interleaved",
    data: outputData,
    count,
    width,
    height,
    mask,
    transform,
    crs,
    nodata,
  };
}

/**
 * Assemble band-separate tiles into a single band-separate
 * {@link RasterArray}.
 */
function assembleBandSeparate(
  tiles: Tile[],
  opts: AssembleTilesOptions,
  meta: ArrayMeta,
): RasterArray {
  const { width, height, tileWidth, tileHeight, minCol, minRow } = opts;
  const { count, transform, crs, nodata, mask } = meta;
  const firstArray = tiles[0]!.array;

  if (firstArray.layout !== "band-separate") {
    throw new Error("Expected band-separate layout");
  }

  // Allocate output bands with the same typed array type as the input
  const Ctor = firstArray.bands[0]!.constructor as new (
    length: number,
  ) => RasterTypedArray;
  const outputBands: RasterTypedArray[] = [];
  for (let b = 0; b < count; b++) {
    outputBands.push(new Ctor(width * height));
  }

  for (const tile of tiles) {
    const { array } = tile;
    if (array.layout !== "band-separate") {
      throw new Error("All tiles must have the same layout");
    }

    const colOffset = (tile.x - minCol) * tileWidth;
    const rowOffset = (tile.y - minRow) * tileHeight;

    for (let b = 0; b < count; b++) {
      copyRows(array.bands[b]!, outputBands[b]!, {
        srcWidth: array.width,
        dstWidth: width,
        colOffset,
        rowOffset,
        copyWidth: array.width,
        copyHeight: array.height,
        samplesPerPixel: 1,
      });
    }
  }

  return {
    layout: "band-separate",
    bands: outputBands,
    count,
    width,
    height,
    mask,
    transform,
    crs,
    nodata,
  };
}

/**
 * Copy rows from a source typed array into a destination typed array,
 * accounting for the stride difference between source and destination widths.
 *
 * For pixel-interleaved data, `samplesPerPixel` must be the band count so
 * that each pixel's samples are copied together.
 */
function copyRows(
  src: RasterTypedArray,
  dst: RasterTypedArray,
  opts: {
    srcWidth: number;
    dstWidth: number;
    colOffset: number;
    rowOffset: number;
    copyWidth: number;
    copyHeight: number;
    samplesPerPixel: number;
  },
): void {
  const {
    srcWidth,
    dstWidth,
    colOffset,
    rowOffset,
    copyWidth,
    copyHeight,
    samplesPerPixel,
  } = opts;
  const srcStride = srcWidth * samplesPerPixel;
  const dstStride = dstWidth * samplesPerPixel;
  const copyStride = copyWidth * samplesPerPixel;

  for (let row = 0; row < copyHeight; row++) {
    const srcStart = row * srcStride;
    const dstStart =
      (rowOffset + row) * dstStride + colOffset * samplesPerPixel;
    dst.set(src.subarray(srcStart, srcStart + copyStride), dstStart);
  }
}

/**
 * Validate that the tiles form a contiguous rectangular grid matching the
 * expected dimensions. Throws if tiles are missing, duplicated, or outside
 * the expected range.
 */
function validateContiguousGrid(
  tiles: Tile[],
  opts: AssembleTilesOptions,
): void {
  if (tiles.length === 0) {
    throw new Error("At least one tile is required");
  }

  const { width, height, tileWidth, tileHeight, minCol, minRow } = opts;
  const numCols = width / tileWidth;
  const numRows = height / tileHeight;
  const expectedCount = numCols * numRows;

  if (tiles.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} tiles for a ${numCols}x${numRows} grid, got ${tiles.length}`,
    );
  }

  const seen = new Set<string>();
  for (const tile of tiles) {
    const col = tile.x - minCol;
    const row = tile.y - minRow;
    if (col < 0 || col >= numCols || row < 0 || row >= numRows) {
      throw new Error(
        `Tile (${tile.x}, ${tile.y}) is outside the expected grid range ` +
          `[${minCol}..${minCol + numCols - 1}] x [${minRow}..${minRow + numRows - 1}]`,
      );
    }
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate tile at (${tile.x}, ${tile.y})`);
    }
    seen.add(key);
  }
}

/**
 * Fill rows in a destination array with a constant value. Used when a tile
 * has no mask but other tiles in the assembly do.
 */
function fillRows(
  dst: Uint8Array,
  opts: {
    dstWidth: number;
    colOffset: number;
    rowOffset: number;
    fillWidth: number;
    fillHeight: number;
    value: number;
  },
): void {
  const { dstWidth, colOffset, rowOffset, fillWidth, fillHeight, value } = opts;
  for (let row = 0; row < fillHeight; row++) {
    const dstStart = (rowOffset + row) * dstWidth + colOffset;
    dst.fill(value, dstStart, dstStart + fillWidth);
  }
}
