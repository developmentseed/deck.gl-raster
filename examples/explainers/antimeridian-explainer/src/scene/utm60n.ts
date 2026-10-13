import type { Affine } from "@developmentseed/affine";
import { apply, invert } from "@developmentseed/affine";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import proj4 from "proj4";

/**
 * Width of geotiff-test-data's `antimeridian_UTM_60N.tif`, in pixels. The PNG
 * in `src/assets` is the same image scaled up 24× with nearest neighbour.
 */
export const UTM_WIDTH = 42;

/** Height of `antimeridian_UTM_60N.tif`, in pixels. */
export const UTM_HEIGHT = 42;

/**
 * Pixel → UTM zone 60N affine, in `[a, b, c, d, e, f]` order: 20 km pixels
 * from origin (300000, 6200000), from the fixture's `_info.md`.
 */
export const UTM_AFFINE: Affine = [20000, 0, 300000, 0, -20000, 6200000];

/** Ground size of one source pixel, in kilometres. */
export const UTM_PIXEL_KM = 20;

/** Width of one Web Mercator world, in metres: x wraps with this period. */
export const WORLD_WIDTH = 2 * 20037508.342789244;

const INVERSE_AFFINE = invert(UTM_AFFINE);
const utmMercator = proj4("EPSG:32660", "EPSG:3857");
const utmWgs84 = proj4("EPSG:32660", "EPSG:4326");
const wgs84Mercator = proj4("EPSG:4326", "EPSG:3857");

/** Source pixel (x right, y down) → UTM metres. */
export function pixelToUtm(x: number, y: number): [number, number] {
  return apply(UTM_AFFINE, x, y);
}

/** UTM metres → source pixel. */
export function utmToPixel(x: number, y: number): [number, number] {
  return apply(INVERSE_AFFINE, x, y);
}

/**
 * UTM metres → Web Mercator metres. Like proj4, wraps x into one world, so
 * points east of 180° come back near the west edge.
 */
export function utmToWebMercator(x: number, y: number): [number, number] {
  return utmMercator.forward<[number, number]>([x, y], false);
}

/** Web Mercator metres → UTM metres. Accepts x from any world copy. */
export function webMercatorToUtm(x: number, y: number): [number, number] {
  return utmMercator.inverse<[number, number]>([x, y], false);
}

/** Longitude, latitude (degrees) → UTM metres. */
export function lngLatToUtm(lng: number, lat: number): [number, number] {
  return utmWgs84.inverse<[number, number]>([lng, lat], false);
}

/** UTM metres → longitude, latitude (degrees), longitude in [−180, 180]. */
export function utmToLngLat(x: number, y: number): [number, number] {
  return utmWgs84.forward<[number, number]>([x, y], false);
}

/** Longitude, latitude (degrees) → Web Mercator (EPSG:3857) metres. */
export function lngLatToWebMercator(
  lng: number,
  lat: number,
): [number, number] {
  return wgs84Mercator.forward<[number, number]>([lng, lat], false);
}

/** The functions `RasterReprojector` needs to map this image to Web Mercator. */
export const UTM_TO_WEB_MERCATOR: ReprojectionFns = {
  forwardTransform: pixelToUtm,
  inverseTransform: utmToPixel,
  forwardReproject: utmToWebMercator,
  inverseReproject: webMercatorToUtm,
};
