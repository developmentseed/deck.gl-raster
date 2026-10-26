// Utilities for interacting with a GeoTIFF

import type {
  ConcurrencyLimiter,
  Priority,
  RasterArray,
  RasterArrayBandSeparate,
  RasterArrayPixelInterleaved,
} from "@developmentseed/geotiff";
import { GeoTIFF } from "@developmentseed/geotiff";
import { normalizeLongitudes, unwrapAlong } from "@developmentseed/proj";
import type { Converter } from "proj4";

/**
 * Add an alpha channel to an RGB image array.
 *
 * Only supports input arrays with 3 (RGB) or 4 (RGBA) channels. If the input is
 * already RGBA, it is returned unchanged. The result keeps the input's layout:
 * a band-separate image gets a fourth, opaque band.
 */
export function addAlphaChannel(
  rgbImage: RasterArrayPixelInterleaved,
): RasterArrayPixelInterleaved;
export function addAlphaChannel(
  rgbImage: RasterArrayBandSeparate,
): RasterArrayBandSeparate;
export function addAlphaChannel(rgbImage: RasterArray): RasterArray;
export function addAlphaChannel(rgbImage: RasterArray): RasterArray {
  const { height, width } = rgbImage;

  if (rgbImage.layout === "band-separate") {
    const { bands } = rgbImage;
    if (bands.length === 4) {
      // Already has alpha channel
      return rgbImage;
    } else if (bands.length === 3) {
      // Need to add alpha channel, as a fourth band
      const isUint16 = bands[0] instanceof Uint16Array;
      const alpha = isUint16
        ? new Uint16Array(height * width).fill(65535)
        : new Uint8ClampedArray(height * width).fill(255);
      return {
        ...rgbImage,
        count: 4,
        bands: [...bands, alpha],
      };
    } else {
      throw new Error(
        `Unexpected number of channels in raster data: ${bands.length}`,
      );
    }
  }

  if (rgbImage.data.length === height * width * 4) {
    // Already has alpha channel
    return rgbImage;
  } else if (rgbImage.data.length === height * width * 3) {
    // Need to add alpha channel

    const rgbaLength = (rgbImage.data.length / 3) * 4;
    const isUint16 = rgbImage.data instanceof Uint16Array;
    const rgbaArray = isUint16
      ? new Uint16Array(rgbaLength)
      : new Uint8ClampedArray(rgbaLength);
    const maxAlpha = isUint16 ? 65535 : 255;
    for (let i = 0; i < rgbImage.data.length / 3; ++i) {
      rgbaArray[i * 4] = rgbImage.data[i * 3]!;
      rgbaArray[i * 4 + 1] = rgbImage.data[i * 3 + 1]!;
      rgbaArray[i * 4 + 2] = rgbImage.data[i * 3 + 2]!;
      rgbaArray[i * 4 + 3] = maxAlpha;
    }

    return {
      ...rgbImage,
      count: 4,
      data: rgbaArray,
    };
  } else {
    throw new Error(
      `Unexpected number of channels in raster data: ${rgbImage.data.length / (height * width)}`,
    );
  }
}

export async function fetchGeoTIFF(
  input: GeoTIFF | string | URL | ArrayBuffer,
  options: {
    concurrencyLimiter?: ConcurrencyLimiter | null;
    getPriority?: () => Priority;
    signal?: AbortSignal;
  } = {},
): Promise<GeoTIFF> {
  if (typeof input === "string" || input instanceof URL) {
    try {
      return await GeoTIFF.fromUrl(input, options);
    } catch (error) {
      // The HTTP source wraps an aborted read in its own error, so throw the
      // abort itself
      options.signal?.throwIfAborted();
      throw error;
    }
  }

  if (input instanceof ArrayBuffer) {
    return await GeoTIFF.fromArrayBuffer(input);
  }

  return input;
}

/**
 * Calculate the WGS84 bounding box of a GeoTIFF image
 *
 * An image across the antimeridian is bounded the short way: `west` is in
 * [-180°, 180°), and `east` can run past 180°, as MapLibre's `fitBounds`
 * accepts. An image that goes all the way around gets -180° to 180°.
 */
export function getGeographicBounds(
  geotiff: GeoTIFF,
  converter: Converter,
): { west: number; south: number; east: number; north: number } {
  const [minX, minY, maxX, maxY] = geotiff.bbox;

  // Reproject all four corners to handle rotation/skew
  const outline: [number, number][] = [
    [minX, minY], // bottom-left
    [maxX, minY], // bottom-right
    [maxX, maxY], // top-right
    [minX, maxY], // top-left
  ];
  const corners = outline.map((corner) => converter.forward(corner));

  // Unwrap each corner's longitude by walking the outline to it from the
  // previous corner, so an image across the antimeridian goes the short way.
  const lons = [corners[0]![0]];
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1]!;
    const [x1, y1] = outline[i]!;
    lons.push(
      unwrapAlong(
        (t) => converter.forward([x0 + t * (x1 - x0), y0 + t * (y1 - y0)])[0]!,
        { start: lons[i - 1]!, period: 360 },
      ),
    );
  }
  const lats = corners.map((c) => c[1]);

  // Move west into [-180°, 180°), and east with it: east may then run past
  // 180°. All the way around the world, or around a pole, gives -180° to 180°.
  const [west, south, east, north] = normalizeLongitudes([
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ]);

  // Return bounds in MapLibre format: [[west, south], [east, north]]
  return { west, south, east, north };
}
