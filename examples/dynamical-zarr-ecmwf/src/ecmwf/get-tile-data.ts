import type {
  GetTileDataOptions,
  MinimalZarrTileData,
} from "@developmentseed/deck.gl-zarr";
import type { Texture } from "@luma.gl/core";
import * as zarr from "zarrita";
import { ECMWF_LEAD_TIME_COUNT } from "./metadata.js";

/**
 * Per-tile data for the ECMWF example: a Texture2DArray stacking all 85
 * lead_time frames for one spatial chunk.
 */
export type EcmwfTileData = MinimalZarrTileData & {
  /** r32float Texture2DArray, depth = ECMWF_LEAD_TIME_COUNT. */
  texture: Texture;
};

/**
 * Slice one spatial chunk of an ECMWF variable array and upload the result
 * as a Texture2DArray (one layer per lead_time).
 */
export async function getTileData(
  arr: zarr.Array<zarr.DataType, zarr.Readable>,
  options: GetTileDataOptions,
): Promise<EcmwfTileData> {
  const { device, sliceSpec, width, height, signal } = options;

  const result = await zarr.get(
    arr as zarr.Array<"float32", zarr.Readable>,
    sliceSpec as Parameters<typeof zarr.get>[1],
    { opts: { signal } },
  );

  // Shape must be [depth, height, width] where depth is the kept lead_time dim.
  if (result.shape.length !== 3) {
    throw new Error(
      `Expected 3D sliced result (lead_time, y, x), got shape ` +
        `[${result.shape.join(", ")}]`,
    );
  }
  if (result.shape[0] !== ECMWF_LEAD_TIME_COUNT) {
    throw new Error(
      `Expected depth = ${ECMWF_LEAD_TIME_COUNT}, got ${result.shape[0]}`,
    );
  }
  if (result.shape[1] !== height || result.shape[2] !== width) {
    throw new Error(
      `Tile shape mismatch: expected [${ECMWF_LEAD_TIME_COUNT}, ${height}, ` +
        `${width}], got [${result.shape.join(", ")}]`,
    );
  }

  const data = result.data as Float32Array;

  const texture = device.createTexture({
    dimension: "2d-array",
    format: "r32float",
    width,
    height,
    depth: ECMWF_LEAD_TIME_COUNT,
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
