import type { MinimalTileData } from "@developmentseed/deck.gl-raster";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-zarr";
import type { Texture } from "@luma.gl/core";
import * as zarr from "zarrita";
import type { ModelName } from "../onnx/model-runner.js";
import { NUM_BANDS } from "./constants.js";

/** Which model output a tile's `valueTexture` holds. */
export type TileResult = {
  /** The model that wrote the values. */
  model: ModelName;
  /** The analysis generation the values belong to. */
  generation: number;
};

/**
 * Per-tile data: the raw embeddings stay on the CPU, for the models and for
 * reading clicked pixels, next to two textures on deck.gl's device.
 */
export type AefTileData = MinimalTileData & {
  /** `z/x/y` of the tile in the source's tile grid. */
  key: string;
  /** Raw int8 embeddings, `[64, height, width]`, row-major. */
  embeddings: Int8Array;
  /** r8sint 2D array texture; layer `i` is band `i`. Draws the RGB composite. */
  bandTexture: Texture;
  /** r32float texture holding the latest model output, one value per pixel. */
  valueTexture: Texture;
  /** What `valueTexture` holds, or `null` before the first model run. */
  result: TileResult | null;
};

/**
 * Fetch one spatial chunk × all 64 bands for the pinned year, keep the int8
 * array, and upload it as an `r8sint` 2D array texture. Zarrita's row-major
 * `[band, y, x]` layout matches the texture's layer-major storage, so no
 * transpose is required.
 */
export async function loadTile(
  arr: zarr.Array<"int8", zarr.Readable>,
  options: GetTileDataOptions,
): Promise<AefTileData> {
  const { device, sliceSpec, height, width, signal, x, y, z } = options;

  const chunk = await zarr.get(arr, sliceSpec, { signal });
  const { data } = chunk;

  // The `time` dim is pinned by `selection` to a single index and collapses
  // out, leaving [band, y, x].
  if (
    chunk.shape.length !== 3 ||
    chunk.shape[0] !== NUM_BANDS ||
    chunk.shape[1] !== height ||
    chunk.shape[2] !== width
  ) {
    throw new Error(
      `Expected a chunk of shape [${NUM_BANDS}, ${height}, ${width}], ` +
        `got [${chunk.shape.join(", ")}]`,
    );
  }

  const sampler = {
    minFilter: "nearest",
    magFilter: "nearest",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  } as const;
  const bandTexture = device.createTexture({
    dimension: "2d-array",
    format: "r8sint",
    width,
    height,
    depth: NUM_BANDS,
    mipLevels: 1,
    data,
    sampler,
  });
  const valueTexture = device.createTexture({
    format: "r32float",
    width,
    height,
    mipLevels: 1,
    sampler,
  });

  return {
    key: tileKey(z, x, y),
    embeddings: data,
    bandTexture,
    valueTexture,
    result: null,
    width,
    height,
    byteLength: data.byteLength,
  };
}

/** The key of a tile in the source's tile grid. */
export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

/** Free a tile's textures. */
export function destroyTile(tile: AefTileData): void {
  tile.bandTexture.destroy();
  tile.valueTexture.destroy();
}
