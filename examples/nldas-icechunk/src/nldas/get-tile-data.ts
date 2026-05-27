import type { MinimalTileData } from "@developmentseed/deck.gl-raster";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-zarr";
import type { Texture } from "@luma.gl/core";
import * as zarr from "zarrita";

/** Per-tile data: one spatial chunk uploaded as an r32float texture. */
export type NldasTileData = MinimalTileData & {
  /** r32float 2D texture holding the tile's temperature values. */
  texture: Texture;
};

/**
 * Slice one spatial chunk of the near-surface air temperature array (time
 * pinned by the layer's selection) and upload it as a single-channel float
 * texture. Fill pixels keep their sentinel value (the store's `missing_value`)
 * and are discarded on the GPU by `FilterNoDataVal`.
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

  const texture = device.createTexture({
    format: "r32float",
    width,
    height,
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
