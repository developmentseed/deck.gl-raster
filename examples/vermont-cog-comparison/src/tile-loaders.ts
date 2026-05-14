import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import { addAlphaChannel } from "@developmentseed/deck.gl-geotiff";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";

/**
 * The texture-and-dimensions payload that all tile loaders return and that
 * every render pipeline consumes.
 */
export type TileTextureData = {
  texture: Texture;
  width: number;
  height: number;
};

/**
 * Tile loader for 3- or 4-band pixel-interleaved COGs.
 *
 * Fetches the source tile, asserts pixel-interleaved layout, expands
 * 3-band data to RGBA via `addAlphaChannel` (WebGL2 has no rgb-only 8-bit
 * texture format), and uploads as `rgba8unorm`. For 4-band data the
 * source-side alpha (NIR) is overridden by the shader pipeline (see
 * `SetAlpha1`).
 */
export async function getTileDataRGBA(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<TileTextureData> {
  const { device, x, y, signal } = options;
  const tile = await image.fetchTile(x, y, { signal, boundless: false });
  const array = addAlphaChannel(tile.array);
  if (array.layout === "band-separate") {
    throw new Error("Vermont COGs are expected to be pixel-interleaved");
  }
  const { width, height, data } = array;
  const texture = device.createTexture({
    data,
    format: "rgba8unorm",
    width,
    height,
  });
  return { texture, width, height };
}

/**
 * Tile loader for 1-band grayscale COGs.
 *
 * Uploads the single-channel array as an `r8unorm` texture. The
 * `BlackIsZero` shader module then broadcasts the red channel into
 * green and blue at draw time.
 */
export async function getTileDataGray(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<TileTextureData> {
  const { device, x, y, signal } = options;
  const tile = await image.fetchTile(x, y, { signal, boundless: false });
  const { array } = tile;
  if (array.layout === "band-separate") {
    throw new Error("Vermont COGs are expected to be pixel-interleaved");
  }
  const { width, height, data } = array;
  const texture = device.createTexture({
    data,
    format: "r8unorm",
    width,
    height,
  });
  return { texture, width, height };
}
