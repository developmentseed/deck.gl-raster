import type {
  GetTileDataOptions,
  MinimalTileData,
} from "@developmentseed/deck.gl-geotiff";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";

/** Tile data shape returned by the land-cover example's getTileData. */
export type LandCoverTileData = NonNullable<MinimalTileData> & {
  /** The single-band r8uint texture for this tile. */
  texture: Texture;
  byteLength: number;
};

/**
 * Custom `getTileData` for the land-cover example.
 *
 * Mirrors the default unorm pipeline's tile fetch but uploads the tile
 * as `r8uint` instead of `r8unorm`, so the integer-aware shader modules
 * can read exact category codes via `usampler2D`.
 *
 * Mask handling and 3/4-band fallbacks from the default pipeline are
 * not needed here: the NLCD COG is single-band uint8 with no mask IFD.
 */
export async function getTileData(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<LandCoverTileData> {
  const { device, x, y, signal, pool } = options;
  const tile = await image.fetchTile(x, y, {
    boundless: false,
    pool,
    signal,
  });
  const { array } = tile;
  const { width, height } = array;

  if (array.layout === "band-separate") {
    throw new Error("NLCD data is pixel interleaved");
  }

  const texture = device.createTexture({
    data: array.data,
    format: "r8uint",
    width,
    height,
    sampler: {
      minFilter: "nearest",
      magFilter: "nearest",
    },
  });

  return {
    texture,
    byteLength: array.data.byteLength,
    height,
    width,
  };
}
