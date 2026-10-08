import type { Affine } from "@developmentseed/affine";
import { apply, invert } from "@developmentseed/affine";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import proj4 from "proj4";

/** Width of `nlcd-albers-2500.png`, in pixels. */
export const NLCD_WIDTH = 2500;

/** Height of `nlcd-albers-2500.png`, in pixels. */
export const NLCD_HEIGHT = 1641;

/**
 * The NLCD Albers CRS as a PROJ string. The NLCD COG calls it
 * "AEA        WGS84": EPSG:5070's parameters on the WGS84 datum.
 */
export const NLCD_ALBERS =
  "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";

/**
 * Pixel → Albers affine of the PNG, in `[a, b, c, d, e, f]` order. From the
 * GDAL geotransform `[-2415585, 1920, 0, 3314805, 0, -1919.56…]` in its
 * `.aux.xml` sidecar, which browsers ignore. Pixel (0, 0) is the outer
 * top-left corner of the image.
 */
export const NLCD_AFFINE: Affine = [
  1920, 0, -2415585, 0, -1919.5612431444242, 3314805,
];

/** Approximate ground size of one source pixel, in kilometres. */
export const NLCD_PIXEL_KM = 1.92;

const INVERSE_AFFINE = invert(NLCD_AFFINE);
const albersMercator = proj4(NLCD_ALBERS, "EPSG:3857");
const albersWgs84 = proj4(NLCD_ALBERS, "EPSG:4326");
const wgs84Mercator = proj4("EPSG:4326", "EPSG:3857");

/** Source pixel (x right, y down) → Albers metres. */
export function pixelToAlbers(x: number, y: number): [number, number] {
  return apply(NLCD_AFFINE, x, y);
}

/** Albers metres → source pixel. */
export function albersToPixel(x: number, y: number): [number, number] {
  return apply(INVERSE_AFFINE, x, y);
}

/** Albers metres → Web Mercator (EPSG:3857) metres. */
export function albersToWebMercator(x: number, y: number): [number, number] {
  return albersMercator.forward<[number, number]>([x, y], false);
}

/** Web Mercator (EPSG:3857) metres → Albers metres. */
export function webMercatorToAlbers(x: number, y: number): [number, number] {
  return albersMercator.inverse<[number, number]>([x, y], false);
}

/** Longitude, latitude (degrees) → Albers metres. */
export function lngLatToAlbers(lng: number, lat: number): [number, number] {
  return albersWgs84.inverse<[number, number]>([lng, lat], false);
}

/** Albers metres → longitude, latitude (degrees). */
export function albersToLngLat(x: number, y: number): [number, number] {
  return albersWgs84.forward<[number, number]>([x, y], false);
}

/** Longitude, latitude (degrees) → Web Mercator (EPSG:3857) metres. */
export function lngLatToWebMercator(
  lng: number,
  lat: number,
): [number, number] {
  return wgs84Mercator.forward<[number, number]>([lng, lat], false);
}

/** The functions `RasterReprojector` needs to map this image to Web Mercator. */
export const NLCD_TO_WEB_MERCATOR: ReprojectionFns = {
  forwardTransform: pixelToAlbers,
  inverseTransform: albersToPixel,
  forwardReproject: albersToWebMercator,
  inverseReproject: webMercatorToAlbers,
};
