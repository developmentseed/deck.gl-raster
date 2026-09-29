import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import {
  CreateTexture,
  LinearRescale,
  WhiteIsZero,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import { texture } from "@developmentseed/deck.gl-geotiff";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";

/** Texture payload for a 1-band grayscale tile. */
export type GrayTileData = {
  texture: Texture;
  width: number;
  height: number;
};

// DEP GeoMAD reflectance stretch — uint16 sampled as r16unorm (shader sees
// rawDN / 65535), so the display range needs the same division. Same fixed
// range as antimeridian-mosaic-multi-example's own tuned stretch for the
// same product line; its red-band raster:bands stats across all 12 test
// items cluster around a mean of ~7300–7900, so one fixed range works fine
// everywhere — no need for a per-tile percentile stretch.
const RESCALE_MIN = 7200 / 65535;
const RESCALE_MAX = 12000 / 65535;

/**
 * Tile loader for the 1-band (16-bit unsigned) DEP GeoMAD bands used in this
 * example. `texture.createTextureProps` infers the right WebGL format from
 * the GeoTIFF's own tags (`r16unorm` for this data) rather than assuming
 * 8-bit.
 */
export async function getTileDataGray(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<GrayTileData> {
  const { device, x, y, signal } = options;
  const tile = await image.fetchTile(x, y, { signal, boundless: false });
  const { array } = tile;
  if (array.layout === "band-separate") {
    throw new Error("Expected a pixel-interleaved (1-band) COG");
  }
  const { width, height, data } = array;
  const props = texture.createTextureProps(image as GeoTIFF, data, {
    width,
    height,
  });
  return { texture: device.createTexture(props), width, height };
}

/**
 * Render pipeline showing raw value as white (low) → black (high) —
 * `WhiteIsZero`, matching TIFF `PhotometricInterpretation = 0` regardless of
 * this data's own tag (`= 1`, BlackIsZero).
 */
export function renderGrayWhiteToBlack(data: GrayTileData): RenderTileResult {
  return {
    renderPipeline: [
      { module: CreateTexture, props: { textureName: data.texture } },
      {
        module: LinearRescale,
        props: { rescaleMin: RESCALE_MIN, rescaleMax: RESCALE_MAX },
      },
      { module: WhiteIsZero },
    ],
  };
}
