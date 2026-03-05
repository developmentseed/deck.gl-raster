// Utilities for interacting with a GeoTIFF

import type { RasterArray } from "@developmentseed/geotiff";
import { GeoTIFF } from "@developmentseed/geotiff";
import type { Converter } from "proj4";

/**
 * Add an alpha channel to an RGB image array.
 *
 * Only supports input arrays with 3 (RGB) or 4 (RGBA) channels. If the input is
 * already RGBA, it is returned unchanged.
 */
export function addAlphaChannel(rgbImage: RasterArray): RasterArray {
  const { height, width } = rgbImage;

  if (rgbImage.layout === "band-separate") {
    // This should be pretty easy to do by just returning an additional array of
    // 255s
    // But not sure if we'll want to do that, because it's fine to upload 3
    // separate textures.
    throw new Error("Band-separate images not yet implemented.");
  }

  if (rgbImage.data.length === height * width * 4) {
    // Already has alpha channel
    return rgbImage;
  } else if (rgbImage.data.length === height * width * 3) {
    // Need to add alpha channel

    const rgbaLength = (rgbImage.data.length / 3) * 4;
    const rgbaArray = new Uint8ClampedArray(rgbaLength);
    for (let i = 0; i < rgbImage.data.length / 3; ++i) {
      rgbaArray[i * 4] = rgbImage.data[i * 3]!;
      rgbaArray[i * 4 + 1] = rgbImage.data[i * 3 + 1]!;
      rgbaArray[i * 4 + 2] = rgbImage.data[i * 3 + 2]!;
      rgbaArray[i * 4 + 3] = 255;
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
): Promise<GeoTIFF> {
  if (typeof input === "string" || input instanceof URL) {
    return await GeoTIFF.fromUrl(input);
  }

  if (input instanceof ArrayBuffer) {
    return await GeoTIFF.fromArrayBuffer(input);
  }

  return input;
}

/**
 * Calculate the WGS84 bounding box of a GeoTIFF image
 */
export function getGeographicBounds(
  geotiff: GeoTIFF,
  converter: Converter,
): { west: number; south: number; east: number; north: number } {
  const [minX, minY, maxX, maxY] = geotiff.bbox;

  // Reproject all four corners to handle rotation/skew
  const corners: [number, number][] = [
    converter.forward([minX, minY]), // bottom-left
    converter.forward([maxX, minY]), // bottom-right
    converter.forward([maxX, maxY]), // top-right
    converter.forward([minX, maxY]), // top-left
  ];

  // Find the bounding box that encompasses all reprojected corners
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);

  const west = Math.min(...lons);
  const south = Math.min(...lats);
  const east = Math.max(...lons);
  const north = Math.max(...lats);

  // Return bounds in MapLibre format: [[west, south], [east, north]]
  return { west, south, east, north };
}
