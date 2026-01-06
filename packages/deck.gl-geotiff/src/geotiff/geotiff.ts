// Utilities for interacting with geotiff.js.

import type { GeoTIFF, GeoTIFFImage, TypedArrayWithDimensions } from "geotiff";
import {
  BaseClient,
  fromArrayBuffer,
  fromBlob,
  fromCustomClient,
  fromUrl,
  Pool,
} from "geotiff";
import type { Converter } from "proj4";

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
export function addAlphaChannel(rgbImage: TypedArrayWithDimensions): ImageData {
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

/**
 * Parse the GeoTIFF `ColorMap` tag into an ImageData.
 *
 * @param   {Uint16Array}  cmap  The colormap array from the GeoTIFF `ColorMap` tag.
 *
 * @return  {ImageData}          The parsed colormap as an ImageData object.
 */
export function parseColormap(cmap: Uint16Array): ImageData {
  // TODO: test colormap handling on a 16-bit image with 2^16 entries?
  const size = cmap.length / 3;
  const rgba = new Uint8ClampedArray(size * 4);

  const rOffset = 0;
  const gOffset = size;
  const bOffset = size * 2;

  // Note: >> 8 is needed to convert from 16-bit to 8-bit color values
  // It just divides by 256 and floors to nearest integer
  for (let i = 0; i < size; i++) {
    rgba[4 * i + 0] = cmap[rOffset + i]! >> 8;
    rgba[4 * i + 1] = cmap[gOffset + i]! >> 8;
    rgba[4 * i + 2] = cmap[bOffset + i]! >> 8;

    // Full opacity
    rgba[4 * i + 3] = 255;
  }

  return new ImageData(rgba, size, 1);
}

export async function fetchGeoTIFF(
  input: GeoTIFF | string | ArrayBuffer | Blob | BaseClient,
): Promise<GeoTIFF> {
  if (typeof input === "string") {
    return fromUrl(input);
  }

  if (input instanceof ArrayBuffer) {
    return fromArrayBuffer(input);
  }

  if (input instanceof Blob) {
    return fromBlob(input);
  }

  // TODO: instanceof may fail here if multiple versions of geotiff.js are
  // present
  if (input instanceof BaseClient) {
    return fromCustomClient(input);
  }

  return input;
}

/**
 * Calculate the WGS84 bounding box of a GeoTIFF image
 */
export function getGeographicBounds(
  image: GeoTIFFImage,
  converter: Converter,
): { west: number; south: number; east: number; north: number } {
  const projectedBbox = image.getBoundingBox() as [
    number,
    number,
    number,
    number,
  ];

  // Reproject all four corners to handle rotation/skew
  const [minX, minY, maxX, maxY] = projectedBbox;
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

/** Parse the GDAL_NODATA TIFF tag into a number. */
export function parseGDALNoData(
  GDAL_NODATA: string | undefined,
): number | null {
  if (!GDAL_NODATA) {
    return null;
  }

  // Remove trailing null character if present
  const noDataString =
    GDAL_NODATA?.[GDAL_NODATA?.length - 1] === "\x00"
      ? GDAL_NODATA.slice(0, -1)
      : GDAL_NODATA;

  return noDataString?.length > 0 ? parseFloat(noDataString) : null;
}
