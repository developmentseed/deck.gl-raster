/* eslint-env browser */

import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import {
  applyAffine,
  invertGeoTransform,
} from "@developmentseed/raster-reproject/affine";
import type { GeoTIFF, GeoTIFFImage } from "geotiff";
import proj4 from "proj4";
import type { PROJJSONDefinition } from "proj4/dist/lib/core";
import type Projection from "proj4/dist/lib/Proj";

// Derived from existing work here:
// https://github.com/developmentseed/lonboard/blob/35a1f3d691604ad9e083bf10a4bfde4158171486/src/cog-tileset/claude-tileset-2d-improved.ts#L141
//
// TODO: return a RasterReprojector instance, given the IFD and tile of interest?
export async function extractGeotiffReprojectors(
  tiff: GeoTIFF,
  sourceProjection: string | PROJJSONDefinition,
  outputCrs: string | PROJJSONDefinition | Projection = "EPSG:4326",
): Promise<ReprojectionFns> {
  const image = await tiff.getImage();

  // Extract geotransform from full-resolution image
  // Only the top-level IFD has geo keys, so we'll derive overviews from this
  const baseGeotransform = extractGeotransform(image);

  const converter = proj4(sourceProjection, outputCrs);
  const { forwardTransform, inverseTransform } =
    fromGeoTransform(baseGeotransform);

  return {
    forwardTransform,
    inverseTransform,
    forwardReproject: (x: number, y: number) =>
      converter.forward([x, y], false),
    inverseReproject: (x: number, y: number) =>
      converter.inverse([x, y], false),
  };
}

export function fromGeoTransform(
  geotransform: [number, number, number, number, number, number],
): {
  forwardTransform: (x: number, y: number) => [number, number];
  inverseTransform: (x: number, y: number) => [number, number];
} {
  const inverseGeotransform = invertGeoTransform(geotransform);
  return {
    forwardTransform: (x: number, y: number) => applyAffine(x, y, geotransform),
    inverseTransform: (x: number, y: number) =>
      applyAffine(x, y, inverseGeotransform),
  };
}

/**
 * Extract affine geotransform from a GeoTIFF image.
 *
 * The first `image` must be passed in, as only the top-level IFD contains geo
 * keys.
 *
 * Returns a 6-element array in Python `affine` package ordering:
 * [a, b, c, d, e, f] where:
 * - x_geo = a * col + b * row + c
 * - y_geo = d * col + e * row + f
 *
 * This is NOT GDAL ordering, which is [c, a, b, f, d, e].
 */
export function extractGeotransform(
  image: GeoTIFFImage,
): [number, number, number, number, number, number] {
  const origin = image.getOrigin();
  const resolution = image.getResolution();

  // origin: [x, y, z]
  // resolution: [x_res, y_res, z_res]

  // Check for rotation/skew in the file directory
  const fileDirectory = image.getFileDirectory();
  const modelTransformation = fileDirectory.ModelTransformation;

  let b = 0; // row rotation
  let d = 0; // column rotation

  if (modelTransformation && modelTransformation.length >= 16) {
    // ModelTransformation is a 4x4 matrix in row-major order
    // [0  1  2  3 ]   [a  b  0  c]
    // [4  5  6  7 ] = [d  e  0  f]
    // [8  9  10 11]   [0  0  1  0]
    // [12 13 14 15]   [0  0  0  1]
    b = modelTransformation[1];
    d = modelTransformation[4];
  }

  // Return in affine package ordering: [a, b, c, d, e, f]
  return [
    resolution[0]!, // a: pixel width
    b, // b: row rotation
    origin[0]!, // c: x origin
    d, // d: column rotation
    resolution[1]!, // e: pixel height (often negative)
    origin[1]!, // f: y origin
  ];
}
