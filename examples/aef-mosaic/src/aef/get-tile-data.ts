import type {
  GetTileDataOptions,
  MinimalZarrTileData,
} from "@developmentseed/deck.gl-zarr";
import type { Texture } from "@luma.gl/core";
import * as zarr from "zarrita";
import { NUM_BANDS } from "./constants.js";

/**
 * Per-tile data for the AEF example: an r8sint Texture2DArray whose depth
 * equals the number of embedding bands ({@link NUM_BANDS}).
 */
export type AefTileData = MinimalZarrTileData & {
  /** r8sint Texture2DArray; depth = NUM_BANDS. Layer `i` = band `i`. */
  texture: Texture;
};

/**
 * Slice one spatial chunk × all 64 bands for the pinned year, then upload
 * the raw int8 data as an `r8sint` Texture2DArray. Zarrita's row-major
 * `[band, y, x]` layout matches the Texture2DArray's layer-major storage
 * one-for-one, so no transpose is required.
 */
export async function getTileData(
  arr: zarr.Array<"int8", zarr.Readable>,
  options: GetTileDataOptions,
): Promise<AefTileData> {
  const { device, sliceSpec, width, height, signal } = options;

  const chunk = await zarr.get(arr, sliceSpec, { signal });
  const { data } = chunk;

  // Shape after slicing must be [NUM_BANDS, height, width]. The `time` dim
  // is pinned by `selection` to a single index and collapses out.
  if (chunk.shape.length !== 3) {
    throw new Error(
      `Expected 3D sliced chunk (band, y, x), got shape [${chunk.shape.join(
        ", ",
      )}]`,
    );
  }
  if (chunk.shape[0] !== NUM_BANDS) {
    throw new Error(
      `Expected depth = ${NUM_BANDS} bands, got ${chunk.shape[0]}`,
    );
  }
  if (chunk.shape[1] !== height || chunk.shape[2] !== width) {
    throw new Error(
      `Tile shape mismatch: expected [${NUM_BANDS}, ${height}, ${width}], ` +
        `got [${chunk.shape.join(", ")}]`,
    );
  }

  const texture = device.createTexture({
    dimension: "2d-array",
    format: "r8sint",
    width,
    height,
    depth: NUM_BANDS,
    mipLevels: 1,
    data,
    sampler: {
      minFilter: "nearest",
      magFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    },
  });

  return {
    texture,
    width,
    height,
    byteLength: data.byteLength,
  };
}
