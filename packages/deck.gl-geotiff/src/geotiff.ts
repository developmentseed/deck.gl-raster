// Utilities for interacting with geotiff.js.

import type { GeoTIFFImage, TypedArrayWithDimensions } from "geotiff";
import { Pool } from "geotiff";

/**
 * Options that may be passed when reading image data from geotiff.js
 */
type ReadRasterOptions = {
  /** the subset to read data from in pixels. */
  window?: [number, number, number, number];

  /** The optional decoder pool to use. */
  pool?: Pool;

  /** An AbortSignal that may be signalled if the request is to be aborted */
  signal?: AbortSignal;
};

/**
 * A default geotiff.js decoder pool instance.
 *
 * It will be created on first call of `defaultPool`.
 */
let DEFAULT_POOL: Pool | null = null;

/**
 * Retrieve the default geotiff.js decoder Pool.
 *
 * If a Pool has not yet been created, it will be created on first call.
 *
 * The Pool will be shared between all COGLayer and GeoTIFFLayer instances.
 */
export function defaultPool(): Pool {
  if (DEFAULT_POOL === null) {
    DEFAULT_POOL = new Pool();
  }

  return DEFAULT_POOL;
}

/**
 * Load an RGBA image from a GeoTIFFImage.
 */
export async function loadRgbImage(
  image: GeoTIFFImage,
  options?: ReadRasterOptions,
): Promise<{ texture: ImageData; height: number; width: number }> {
  const mergedOptions = {
    ...options,
    interleave: true,
    enableAlpha: true,
  };
  // Since we set interleave: true, the result is a single array with all
  // samples, so we cast to TypedArrayWithDimensions
  // https://github.com/geotiffjs/geotiff.js/issues/486
  const rgbImage = (await image.readRGB(
    mergedOptions,
  )) as TypedArrayWithDimensions;
  const imageData = addAlphaChannel(rgbImage);

  return {
    texture: imageData,
    height: rgbImage.height,
    width: rgbImage.width,
  };
}

/**
 * Add an alpha channel to an RGB image array.
 *
 * Only supports input arrays with 3 (RGB) or 4 (RGBA) channels. If the input is
 * already RGBA, it is returned unchanged.
 */
function addAlphaChannel(rgbImage: TypedArrayWithDimensions): ImageData {
  const { height, width } = rgbImage;

  if (rgbImage.length === height * width * 4) {
    // Already has alpha channel
    return new ImageData(new Uint8ClampedArray(rgbImage), width, height);
  } else if (rgbImage.length === height * width * 3) {
    // Need to add alpha channel

    const rgbaLength = (rgbImage.length / 3) * 4;
    const rgbaArray = new Uint8ClampedArray(rgbaLength);
    for (let i = 0; i < rgbImage.length / 3; ++i) {
      rgbaArray[i * 4] = rgbImage[i * 3]!;
      rgbaArray[i * 4 + 1] = rgbImage[i * 3 + 1]!;
      rgbaArray[i * 4 + 2] = rgbImage[i * 3 + 2]!;
      rgbaArray[i * 4 + 3] = 255;
    }

    return new ImageData(rgbaArray, width, height);
  } else {
    throw new Error(
      `Unexpected number of channels in raster data: ${rgbImage.length / (height * width)}`,
    );
  }
}
