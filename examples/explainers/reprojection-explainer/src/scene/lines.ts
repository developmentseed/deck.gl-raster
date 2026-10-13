import type { ReprojectionFns } from "@developmentseed/raster-reproject";

/** A polyline as a list of `[x, y]` points. */
export type Polyline = [number, number][];

/** Bounding box `[minX, minY, maxX, maxY]`. */
export type Bounds = [number, number, number, number];

/**
 * A parallel (constant latitude) across `lngRange`, with each point mapped by
 * `project` from longitude, latitude (degrees) into the wanted coordinates.
 */
export function parallelPolyline(
  project: (lng: number, lat: number) => [number, number],
  lat: number,
  lngRange: [number, number],
  samples = 129,
): Polyline {
  return sampleRange(lngRange, samples).map((lng) => project(lng, lat));
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

/** The image's outline reprojected to the target CRS. */
export function imageOutlineInTarget(
  fns: ReprojectionFns,
  width: number,
  height: number,
  samplesPerEdge = 64,
): Polyline {
  return imageOutlineInPixels(width, height, samplesPerEdge).map(([x, y]) =>
    fns.forwardReproject(...fns.forwardTransform(x, y)),
  );
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
