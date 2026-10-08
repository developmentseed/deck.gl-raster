import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { RasterReprojector } from "@developmentseed/raster-reproject";

/** The triangle one refinement step splits, and where. */
export type RefinementSplit = {
  /** Index of the triangle in the mesh before the split. */
  index: number;
  /** Vertex ids of that triangle. */
  triangle: [number, number, number];
  /** Texture coordinate of the new vertex (0–1, v down). */
  uv: [number, number];
  /**
   * Where the GPU draws that point before the split: the linear
   * interpolation of the triangle's exact output positions (target CRS).
   */
  guess: [number, number];
  /** Error at that point before the split, in source pixels. */
  error: number;
};

/** One call to `RasterReprojector.refine()`. */
export type RefinementStep = {
  /** The split this step made. */
  split: RefinementSplit;
  /** Id of the vertex this step added. */
  vertex: number;
  /** Triangle vertex ids after this step, 3 per triangle. */
  triangles: Uint32Array;
  /** Largest remaining error after this step, in source pixels. */
  maxError: number;
};

/** The refinement history of one mesh, from its 2-triangle seed. */
export type RefinementRecord = {
  /** Texture coordinates of every vertex of the final mesh, 2 per vertex. */
  uvs: Float64Array;
  /** Exact output positions (target CRS) of every vertex, 2 per vertex. */
  positions: Float64Array;
  /** Triangle vertex ids of the seed mesh. */
  seedTriangles: Uint32Array;
  /** Largest error of the seed mesh, in source pixels. */
  seedMaxError: number;
  /** One entry per `refine()` call, in order. Vertex ids are stable. */
  steps: RefinementStep[];
};

/** Options for {@link recordRefinement}. */
export type RecordRefinementOptions = {
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** Stop once the largest error is at most this many source pixels. */
  maxError: number;
  /** Safety cap on the number of steps. */
  maxSteps?: number;
};

/** Private `RasterReprojector` state that reveals the next split. */
type ReprojectorInternals = {
  _queue: number[];
  _errors: number[];
  _candidatesUV: number[];
};

/**
 * Run `RasterReprojector` one `refine()` at a time and record every step.
 *
 * Reads the reprojector's private priority queue (with a cast; no package
 * change) to learn which triangle each step splits and where. Uses the same
 * `width + 1`, `height + 1` convention as `RasterLayer`, so UV (1, 1) is the
 * outer corner of the last pixel.
 */
export function recordRefinement(
  fns: ReprojectionFns,
  options: RecordRefinementOptions,
): RefinementRecord {
  const { width, height, maxError, maxSteps = 10_000 } = options;
  const reprojector = new RasterReprojector(fns, width + 1, height + 1);
  const internals = reprojector as unknown as ReprojectorInternals;
  const seedTriangles = Uint32Array.from(reprojector.triangles);
  const seedMaxError = reprojector.getMaxError();
  const steps: RefinementStep[] = [];

  while (reprojector.getMaxError() > maxError && steps.length < maxSteps) {
    const index = internals._queue[0]!;
    const { triangles } = reprojector;
    const triangle: [number, number, number] = [
      triangles[3 * index]!,
      triangles[3 * index + 1]!,
      triangles[3 * index + 2]!,
    ];
    const uv: [number, number] = [
      internals._candidatesUV[2 * index]!,
      internals._candidatesUV[2 * index + 1]!,
    ];
    const guess = interpolateOutput(reprojector, triangle, uv);
    const error = internals._errors[0]!;
    const vertex = reprojector.uvs.length / 2;

    reprojector.refine();

    steps.push({
      split: { index, triangle, uv, guess, error },
      vertex,
      triangles: Uint32Array.from(reprojector.triangles),
      maxError: reprojector.getMaxError(),
    });
  }

  return {
    uvs: Float64Array.from(reprojector.uvs),
    positions: Float64Array.from(reprojector.exactOutputPositions),
    seedTriangles,
    seedMaxError,
    steps,
  };
}

/** Linearly interpolate a triangle's exact output positions at a UV point. */
function interpolateOutput(
  reprojector: RasterReprojector,
  [a, b, c]: [number, number, number],
  uv: [number, number],
): [number, number] {
  const { uvs, exactOutputPositions: out } = reprojector;
  const [wa, wb, wc] = barycentric(
    uv,
    [uvs[2 * a]!, uvs[2 * a + 1]!],
    [uvs[2 * b]!, uvs[2 * b + 1]!],
    [uvs[2 * c]!, uvs[2 * c + 1]!],
  );
  return [
    wa * out[2 * a]! + wb * out[2 * b]! + wc * out[2 * c]!,
    wa * out[2 * a + 1]! + wb * out[2 * b + 1]! + wc * out[2 * c + 1]!,
  ];
}

/** Barycentric weights of point `p` in triangle `(a, b, c)`. */
export function barycentric(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  c: [number, number],
): [number, number, number] {
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const wa =
    ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / det;
  const wb =
    ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / det;
  return [wa, wb, 1 - wa - wb];
}

/** Number of triangles `RasterReprojector` builds for an image at `maxError`. */
export function countTriangles(
  fns: ReprojectionFns,
  options: { width: number; height: number; maxError: number },
): number {
  const reprojector = new RasterReprojector(
    fns,
    options.width + 1,
    options.height + 1,
  );
  reprojector.run(options.maxError);
  return reprojector.triangles.length / 3;
}
