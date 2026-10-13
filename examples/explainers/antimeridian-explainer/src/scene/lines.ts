import { snapToCopy } from "@developmentseed/raster-reproject";
import {
  lngLatToUtm,
  pixelToUtm,
  utmToPixel,
  utmToWebMercator,
  WORLD_WIDTH,
} from "./utm60n.js";

/** A polyline as a list of `[x, y]` points. */
export type Polyline = [number, number][];

/** Bounding box `[minX, minY, maxX, maxY]`. */
export type Bounds = [number, number, number, number];

/** A meridian (constant longitude) in the source image's pixel coordinates. */
export function meridianInPixels(
  lng: number,
  latRange: [number, number],
  samples = 65,
): Polyline {
  return sampleRange(latRange, samples).map((lat) =>
    utmToPixel(...lngLatToUtm(lng, lat)),
  );
}

/**
 * The image's outline as a closed ring in pixel coordinates, clockwise from
 * the top-left corner, with `samplesPerEdge` points per edge.
 */
export function imageOutlineInPixels(
  width: number,
  height: number,
  samplesPerEdge = 64,
): Polyline {
  const corners: [number, number][] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const ring: Polyline = [];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = corners[i]!;
    const [x1, y1] = corners[(i + 1) % 4]!;
    for (let s = 0; s < samplesPerEdge; s++) {
      const t = s / samplesPerEdge;
      ring.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  ring.push(ring[0]!);
  return ring;
}

/**
 * The image's outline reprojected to Web Mercator metres, unwrapped: each
 * point's x is moved to the world copy nearest the point before it, so the
 * ring stays in one piece across 180°.
 */
export function imageOutlineInWebMercator(
  width: number,
  height: number,
  samplesPerEdge = 64,
): Polyline {
  const ring = imageOutlineInPixels(width, height, samplesPerEdge).map(
    ([x, y]) => utmToWebMercator(...pixelToUtm(x, y)),
  );
  for (let i = 1; i < ring.length; i++) {
    ring[i]![0] = snapToCopy(ring[i]![0], ring[i - 1]![0], WORLD_WIDTH);
  }
  return ring;
}

/** Bounding box of a polyline. */
export function polylineBounds(line: Polyline): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of line) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

/** `samples` evenly spaced values from `start` to `end` inclusive. */
function sampleRange(
  [start, end]: [number, number],
  samples: number,
): number[] {
  return Array.from(
    { length: samples },
    (_, i) => start + ((end - start) * i) / (samples - 1),
  );
}
