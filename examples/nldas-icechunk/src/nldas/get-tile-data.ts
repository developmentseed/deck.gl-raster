import type { MinimalTileData } from "@developmentseed/deck.gl-raster";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-zarr";
import type { Texture } from "@luma.gl/core";
import * as zarr from "zarrita";
import { NODATA_VALUE } from "./metadata.js";

/** Per-tile data: one spatial chunk uploaded as an r32float texture. */
export type NldasTileData = MinimalTileData & {
  /** r32float 2D texture holding the tile's Tair values. */
  texture: Texture;
};

/**
 * Slice one spatial chunk of Tair (time pinned by the layer's selection) and
 * upload it as a single-channel float texture. Non-finite values (NaN/Inf
 * fills) are mapped to NODATA_VALUE so the render pipeline can discard them.
 */
export async function getTileData(
  arr: zarr.Array<"float32", zarr.Readable>,
  options: GetTileDataOptions,
): Promise<NldasTileData> {
  const { device, sliceSpec, width, height, signal } = options;

  const chunk = await zarr.get(arr, sliceSpec, { signal });
  if (chunk.shape.length !== 2) {
    throw new Error(
      `Expected 2D sliced chunk (y, x), got shape [${chunk.shape.join(", ")}]`,
    );
  }
  if (chunk.shape[0] !== height || chunk.shape[1] !== width) {
    throw new Error(
      `Tile shape mismatch: expected [${height}, ${width}], got ` +
        `[${chunk.shape.join(", ")}]`,
    );
  }

  const data = chunk.data as Float32Array;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i]!)) {
      data[i] = NODATA_VALUE;
    }
  }

  const texture = device.createTexture({
    format: "r32float",
    width,
    height,
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
