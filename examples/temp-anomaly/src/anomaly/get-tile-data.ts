import type {
  GetTileDataOptions,
  MinimalZarrTileData,
} from "@developmentseed/deck.gl-zarr";
import type { Texture } from "@luma.gl/core";
import * as zarr from "zarrita";
import { DATE_COUNT } from "./metadata.js";

/**
 * Per-tile data: a Texture2DArray stacking all DATE_COUNT date frames
 * for one spatial chunk.
 */
export type AnomalyTileData = MinimalZarrTileData & {
  /** r32float Texture2DArray, depth = DATE_COUNT. */
  texture: Texture;
};

/**
 * Slice one spatial chunk of an anomaly variable and upload it as a
 * Texture2DArray (one layer per valid_date).
 */
export async function getTileData(
  arr: zarr.Array<zarr.DataType, zarr.Readable>,
  options: GetTileDataOptions,
): Promise<AnomalyTileData> {
  const { device, sliceSpec, width, height, signal } = options;

  const result = await zarr.get(
    arr as zarr.Array<"float32", zarr.Readable>,
    sliceSpec as Parameters<typeof zarr.get>[1],
    { opts: { signal } },
  );

  if (result.shape.length !== 3) {
    throw new Error(
      `Expected 3D sliced result (valid_date, y, x), got shape [${result.shape.join(", ")}]`,
    );
  }
  if (result.shape[0] !== DATE_COUNT) {
    throw new Error(
      `Expected depth = ${DATE_COUNT}, got ${result.shape[0]}`,
    );
  }
  if (result.shape[1] !== height || result.shape[2] !== width) {
    throw new Error(
      `Tile shape mismatch: expected [${DATE_COUNT}, ${height}, ${width}], got [${result.shape.join(", ")}]`,
    );
  }

  const data = result.data as Float32Array;

  const texture = device.createTexture({
    dimension: "2d-array",
    format: "r32float",
    width,
    height,
    depth: DATE_COUNT,
    mipLevels: 1,
    data,
    sampler: {
      minFilter: "nearest",
      magFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    },
  });

  return { texture, width, height, byteLength: data.byteLength };
}
