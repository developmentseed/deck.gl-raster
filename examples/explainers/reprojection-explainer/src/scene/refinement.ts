import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { RasterReprojector } from "@developmentseed/raster-reproject";

/**
 * The test points `RasterReprojector` measures in every triangle, in
 * barycentric coordinates: the centroid, then the midpoints of edges 0–1,
 * 0–2 and 1–2. Copied from the library, which doesn't export them.
 */
export const SAMPLE_POINTS: [number, number, number][] = [
  [1 / 3, 1 / 3, 1 / 3],
  [0.5, 0.5, 0],
  [0.5, 0, 0.5],
  [0, 0.5, 0.5],
];

/**
 * Where `RasterReprojector` measures a mesh's error: in source pixels (the
 * default), or on the map in units of one source pixel's size there.
 */
export type ErrorSpace = "source" | "target";

/** One test point of a triangle, measured the way the library does. */
export type ErrorSample = {
  /** Texture coordinate of the point (0–1, v down). */
  uv: [number, number];
  /** Where the GPU draws it: the linear guess from the corners (target CRS). */
  guess: [number, number];
  /** Where it really belongs: its exact reprojection (target CRS). */
  exact: [number, number];
  /**
   * The guess mapped back into the image (0–1, v down): the part of the image
   * that belongs where the GPU draws this point.
   */
  sampled: [number, number];
  /**
   * The point's error, in pixels of the reprojector's {@link ErrorSpace}: the
   * distance from `uv` to `sampled` in source pixels, or the distance from
   * `guess` to `exact` over one source pixel's size on the map.
   */
  error: number;
};

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
  /** Error at that point before the split, in pixels. */
  error: number;
  /** The triangle's 4 test points; the worst one is the split point. */
  samples: ErrorSample[];
};

/** One call to `RasterReprojector.refine()`. */
export type RefinementStep = {
  /** The split this step made. */
  split: RefinementSplit;
  /** Id of the vertex this step added. */
  vertex: number;
  /** Triangle vertex ids after this step, 3 per triangle. */
  triangles: Uint32Array;
  /** Largest remaining error after this step, in pixels. */
  maxError: number;
  /** Each triangle's score after this step: its worst test point's error. */
  scores: Float32Array;
};

/**
 * The refinement history of one mesh, from its 2-triangle seed. Errors are in
 * pixels of the {@link ErrorSpace} it was recorded in.
 */
export type RefinementRecord = {
  /** Texture coordinates of every vertex of the final mesh, 2 per vertex. */
  uvs: Float64Array;
  /** Exact output positions (target CRS) of every vertex, 2 per vertex. */
  positions: Float64Array;
  /** Triangle vertex ids of the seed mesh. */
  seedTriangles: Uint32Array;
  /** Largest error of the seed mesh, in pixels. */
  seedMaxError: number;
  /** Each seed triangle's score: its worst test point's error. */
  seedScores: Float32Array;
  /** The 4 test points of each seed triangle. */
  seedSamples: ErrorSample[][];
  /** One entry per `refine()` call, in order. Vertex ids are stable. */
  steps: RefinementStep[];
};

/** Options for {@link recordRefinement}. */
export type RecordRefinementOptions = {
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** Stop once the largest error is at most this many pixels. */
  maxError: number;
  /** Where to measure the error. Defaults to `"source"`. */
  errorSpace?: ErrorSpace;
  /** Safety cap on the number of steps. */
  maxSteps?: number;
};

/**
 * Private `RasterReprojector` state that reveals the next split, and how the
 * error is measured.
 */
type ReprojectorInternals = {
  _queue: number[];
  _errors: number[];
  _queueIndices: number[];
  _candidatesUV: number[];
  _errorSpace: ErrorSpace;
  /** One source pixel's size on the map (1 in source mode). */
  _pixelSize: number;
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
  const { width, height, maxError, errorSpace, maxSteps = 10_000 } = options;
  const reprojector = new RasterReprojector(fns, width + 1, height + 1, {
    errorSpace,
  });
  const internals = reprojector as unknown as ReprojectorInternals;
  const seedTriangles = Uint32Array.from(reprojector.triangles);
  const seedMaxError = reprojector.getMaxError();
  // Every triangle sits in the priority queue, keyed by its worst error.
  const scores = () =>
    Float32Array.from(
      { length: reprojector.triangles.length / 3 },
      (_, t) => internals._errors[internals._queueIndices[t]!]!,
    );
  const seedScores = scores();
  const seedSamples = Array.from({ length: seedTriangles.length / 3 }, (_, t) =>
    measureTriangle(reprojector, [
      seedTriangles[3 * t]!,
      seedTriangles[3 * t + 1]!,
      seedTriangles[3 * t + 2]!,
    ]),
  );
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
      split: {
        index,
        triangle,
        uv,
        guess,
        error,
        samples: measureTriangle(reprojector, triangle),
      },
      vertex,
      triangles: Uint32Array.from(reprojector.triangles),
      maxError: reprojector.getMaxError(),
      scores: scores(),
    });
  }

  return {
    uvs: Float64Array.from(reprojector.uvs),
    positions: Float64Array.from(reprojector.exactOutputPositions),
    seedTriangles,
    seedMaxError,
    seedScores,
    seedSamples,
    steps,
  };
}

/**
 * Measure a triangle's 4 test points the way `RasterReprojector` does:
 * linearly interpolate the corners' exact output positions into the GPU's
 * guess, then compare it with the truth. In source mode, map the guess back
 * into the image and compare with where the point is, in source pixels. In
 * target mode, compare it with the point's exact position on the map, over
 * the reprojector's pixel size. Vertex ids stay valid after later splits, so
 * this works on any snapshot.
 */
function measureTriangle(
  reprojector: RasterReprojector,
  [a, b, c]: [number, number, number],
): ErrorSample[] {
  const { uvs, exactOutputPositions: out, reprojectors: fns } = reprojector;
  const { _errorSpace: errorSpace, _pixelSize: pixelSize } =
    reprojector as unknown as ReprojectorInternals;
  const mix = (array: number[], offset: number, w: number[]) =>
    w[0]! * array[2 * a + offset]! +
    w[1]! * array[2 * b + offset]! +
    w[2]! * array[2 * c + offset]!;
  const pixelScale = [reprojector.width - 1, reprojector.height - 1] as const;
  return SAMPLE_POINTS.map((w) => {
    const uv: [number, number] = [mix(uvs, 0, w), mix(uvs, 1, w)];
    const guess: [number, number] = [mix(out, 0, w), mix(out, 1, w)];
    const pixel = [uv[0] * pixelScale[0], uv[1] * pixelScale[1]] as const;
    const sampled = fns.inverseTransform(...fns.inverseReproject(...guess));
    const exact = fns.forwardReproject(...fns.forwardTransform(...pixel));
    const error =
      errorSpace === "target"
        ? Math.hypot(exact[0] - guess[0], exact[1] - guess[1]) / pixelSize
        : Math.hypot(pixel[0] - sampled[0], pixel[1] - sampled[1]);
    return {
      uv,
      guess,
      exact,
      sampled: [sampled[0] / pixelScale[0], sampled[1] / pixelScale[1]],
      error,
    };
  });
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

/**
 * Iteration cap for {@link countTriangles}: room for about 200,000
 * triangles. The library's default (10,000) stops the Arctic scenario at
 * 0.125 px before it converges.
 */
const COUNT_MAX_ITERATIONS = 100_000;

/**
 * Number of triangles `RasterReprojector` builds for an image at `maxError`,
 * measured in `errorSpace` (`"source"` by default).
 */
export function countTriangles(
  fns: ReprojectionFns,
  options: {
    width: number;
    height: number;
    maxError: number;
    errorSpace?: ErrorSpace;
  },
): number {
  const reprojector = new RasterReprojector(
    fns,
    options.width + 1,
    options.height + 1,
    { errorSpace: options.errorSpace },
  );
  reprojector.run(options.maxError, { maxIterations: COUNT_MAX_ITERATIONS });
  return reprojector.triangles.length / 3;
}
