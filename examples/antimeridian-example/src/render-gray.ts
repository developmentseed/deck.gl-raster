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

/** Texture payload for a 1-band grayscale tile, plus its own contrast-stretch range. */
export type GrayTileData = {
  texture: Texture;
  width: number;
  height: number;
  /** Normalized [0, 1] — inner-90% value range, per-tile. */
  rescaleMin: number;
  rescaleMax: number;
};

/** r16unorm normalizes the raw uint16 sample by this before the shader sees it. */
const UINT16_MAX = 65535;

/**
 * Inner-90% value range (5th/95th percentile), ignoring `nodata` (0 for this
 * dataset). A simple per-tile auto-contrast-stretch — good enough for a demo,
 * not a substitute for a real histogram-based stretch across the whole COG.
 */
function inner90Range(data: ArrayLike<number>): [number, number] {
  const values = Array.from(data).filter((v) => v !== 0);
  if (values.length === 0) {
    return [0, UINT16_MAX];
  }
  values.sort((a, b) => a - b);
  const lo = values[Math.floor(values.length * 0.05)]!;
  const hi = values[Math.ceil(values.length * 0.95) - 1]!;
  return [lo, hi];
}

/**
 * Tile loader for the 1-band (16-bit unsigned) DEP GeoMAD bands used in this
 * example. Both COGs here have no overviews, so `image` is always the base
 * `GeoTIFF`; `texture.createTextureProps` infers the right WebGL format from
 * its tags (`r16unorm` for this data) rather than assuming 8-bit.
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
  const [lo, hi] = inner90Range(data);
  return {
    texture: device.createTexture(props),
    width,
    height,
    rescaleMin: lo / UINT16_MAX,
    rescaleMax: hi / UINT16_MAX,
  };
}

/**
 * Render pipeline showing raw value as white (low) → black (high) —
 * `WhiteIsZero`, matching TIFF `PhotometricInterpretation = 0` regardless of
 * this data's own tag (`= 1`, BlackIsZero). `LinearRescale` runs first, using
 * this tile's own inner-90% range, so `WhiteIsZero` sees an already-stretched
 * [0, 1] value.
 */
export function renderGrayWhiteToBlack(data: GrayTileData): RenderTileResult {
  return {
    renderPipeline: [
      { module: CreateTexture, props: { textureName: data.texture } },
      {
        module: LinearRescale,
        props: { rescaleMin: data.rescaleMin, rescaleMax: data.rescaleMax },
      },
      { module: WhiteIsZero },
    ],
  };
}
