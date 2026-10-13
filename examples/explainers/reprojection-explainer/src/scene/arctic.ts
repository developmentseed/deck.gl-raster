import type { Affine } from "@developmentseed/affine";
import { apply, invert } from "@developmentseed/affine";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import proj4 from "proj4";
import arcticUrl from "../assets/arctic-blue-marble-2048.jpg";
import type { Scenario } from "./scenario.js";

/** Width of `arctic-blue-marble-2048.jpg`, in pixels. */
export const ARCTIC_WIDTH = 2048;

/** Height of `arctic-blue-marble-2048.jpg`, in pixels. */
export const ARCTIC_HEIGHT = 313;

/**
 * Pixel → longitude/latitude affine of the JPEG, in `[a, b, c, d, e, f]`
 * order: 85°N to 30°N, and ±179.93° (GDAL snapped the requested ±179.9° to
 * the source's pixel grid). It stops short of ±180°, where the image's two
 * edges would be the same meridian, and short of the pole.
 */
export const ARCTIC_AFFINE: Affine = [
  359.8666666666667 / ARCTIC_WIDTH,
  0,
  -179.93333333333334,
  0,
  -55 / ARCTIC_HEIGHT,
  85,
];

/** NSIDC polar stereographic north (EPSG:3413), as a PROJ string. */
export const POLAR_STEREOGRAPHIC_NORTH =
  "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";

const INVERSE_AFFINE = invert(ARCTIC_AFFINE);
const lngLatToPolar = proj4("EPSG:4326", POLAR_STEREOGRAPHIC_NORTH);

/** Source pixel (x right, y down) → longitude, latitude. */
export function pixelToLngLat(x: number, y: number): [number, number] {
  return apply(ARCTIC_AFFINE, x, y);
}

/** Longitude, latitude → source pixel. */
export function lngLatToPixel(lng: number, lat: number): [number, number] {
  return apply(INVERSE_AFFINE, lng, lat);
}

/** Longitude, latitude (degrees) → polar stereographic metres. */
export function lngLatToPolarStereographic(
  lng: number,
  lat: number,
): [number, number] {
  return lngLatToPolar.forward<[number, number]>([lng, lat], false);
}

/** The functions `RasterReprojector` needs to map this image to EPSG:3413. */
export const ARCTIC_TO_POLAR_STEREOGRAPHIC: ReprojectionFns = {
  forwardTransform: pixelToLngLat,
  inverseTransform: lngLatToPixel,
  forwardReproject: lngLatToPolarStereographic,
  inverseReproject: (x, y) =>
    lngLatToPolar.inverse<[number, number]>([x, y], false),
};

/**
 * A band of the Arctic in longitude/latitude, rolled into a ring on a polar
 * map. Its pixels shrink to slivers on the map toward the pole, which is
 * where the two error metrics disagree most.
 *
 * The text is a draft, to be replaced with hand-written text.
 */
export const ARCTIC_SCENARIO: Scenario = {
  id: "arctic",
  label: "Arctic → polar stereographic",
  imageUrl: arcticUrl,
  width: ARCTIC_WIDTH,
  height: ARCTIC_HEIGHT,
  fns: ARCTIC_TO_POLAR_STEREOGRAPHIC,
  lngLatToPixel,
  lngLatToTarget: lngLatToPolarStereographic,
  sourceName: "Longitude/latitude (EPSG:4326)",
  targetName: "Polar stereographic (EPSG:3413)",
  parallel: {
    lat: 66.5636,
    lngRange: [-179.93, 179.93],
    label: "Arctic Circle",
    targetSamples: 36,
  },
  // The top edge (85°N) is a small circle on the map, the bottom edge (30°N)
  // a large one, and the sides are straight lines from the pole.
  outlineSamples: [8, 1, 64, 1],
  // A 0.176° pixel at the image's central latitude (57.5°N): about 10.5 km
  // wide and 19.4 km tall.
  kmPerPixel: 14.3,
  // Recording finer meshes takes too much memory: every split keeps a copy.
  maxErrorChoices: [2, 4, 8, 16, 32],
  defaultMaxError: 8,
  credit: {
    text: "Image: NASA Earth Observatory, Blue Marble Next Generation",
    href: "https://earthobservatory.nasa.gov/features/BlueMarble",
  },
  introduction: [
    "[Draft] This band of satellite imagery is stored in longitude and latitude, but we want to display it on a polar map of the Arctic. Note the Arctic Circle: in longitude and latitude it's a straight line, while on the polar map it's a circle around the North Pole.",
  ],
  firstAttempt: ({ error, errorKm, pixels }) => [
    `[Draft] We project the corners of each triangle to the polar map, then stretch the image linearly within each triangle. The image's left and right edges are almost the same meridian, so its four corners land almost on one line and the whole image collapses onto it: at the middle of its bottom edge, the error is ${error} ${pixels}, or about ${errorKm.toLocaleString("en-US")} km.`,
  ],
};
