import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import {
  BlackIsZero,
  CreateTexture,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";

/** Texture payload for a 1-band grayscale tile. */
export type GrayTileData = {
  texture: Texture;
  width: number;
  height: number;
};

// DEP GeoMAD reflectance stretch — uint16 sampled as r16unorm (shader sees
// rawDN / 65535), so the display range needs the same division. Not tuned
// per-tile — this example is about antimeridian correctness, not radiometric
// accuracy, so a simple fixed linear ramp is enough.
const RESCALE_MIN = 7200 / 65535;
const RESCALE_MAX = 12000 / 65535;

/** Tile loader for the 1-band (16-bit unsigned) DEP GeoMAD bands used in this example. */
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
  const texture = device.createTexture({
    data,
    format: "r16unorm",
    width,
    height,
  });
  return { texture, width, height };
}

/**
 * Render pipeline: a plain linear ramp — dark = low value, bright = high
 * value. `BlackIsZero` broadcasts the single band into RGB so it renders as
 * grayscale instead of red-tinted (a bare `r16unorm` texture only has data
 * in the red channel).
 */
export function renderGray(data: GrayTileData): RenderTileResult {
  return {
    renderPipeline: [
      { module: CreateTexture, props: { textureName: data.texture } },
      {
        module: LinearRescale,
        props: { rescaleMin: RESCALE_MIN, rescaleMax: RESCALE_MAX },
      },
      { module: BlackIsZero },
    ],
  };
}
