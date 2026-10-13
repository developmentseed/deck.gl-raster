import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import {
  RasterReprojector,
  snapToCopy,
  unwrapAlong,
} from "@developmentseed/raster-reproject";

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

/** One test point of a triangle, measured the way the library does. */
export type ErrorSample = {
  /** Texture coordinate of the point (0–1, v down). */
  uv: [number, number];
  /** Where the GPU draws it: the linear guess from the corners (target CRS). */
  guess: [number, number];
  /**
   * Where it really belongs: its exact reprojection (target CRS), in the world
   * copy nearest `guess`.
   */
  exact: [number, number];
  /**
   * Distance between the point and the guess mapped back into the source
   * image, in source pixels.
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
  /** Error at that point before the split, in source pixels. */
  error: number;
  /**
   * The reference the new vertex's x is snapped to: the triangle's
   * interpolated x at the split point (`_candidatesOutX`). Equals `guess[0]`.
   */
  refX: number;
  /** The new vertex's exact x as proj4 returns it, before snapping. */
  rawX: number;
  /** The triangle's 4 test points; the worst one is the split point. */
  samples: ErrorSample[];
};

/** One point `unwrapAlong` sampled on the way to a seed corner. */
export type UnwrapSample = {
  /** Position along the path from the previous corner, 0–1. */
  t: number;
  /** Texture coordinate of the point. */
  uv: [number, number];
  /** Its exact x as proj4 returns it. */
  rawX: number;
  /** Its x snapped to the copy nearest the previous sample. */
  x: number;
  /** Its exact y. */
  y: number;
};

/** How one seed corner's x was unwrapped from the corner before it. */
export type SeedUnwrap = {
  /** The corner's vertex id. */
  vertex: number;
  /** The previous corner's vertex id: where the walk starts. */
  from: number;
  /** The points sampled along the way, ending at the corner (t = 1). */
  samples: UnwrapSample[];
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
  /** Each triangle's score after this step: its worst test point's error. */
  scores: Float32Array;
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
  /** Each seed triangle's score: its worst test point's error. */
  seedScores: Float32Array;
  /** The 4 test points of each seed triangle. */
  seedSamples: ErrorSample[][];
  /** Every seed vertex's exact x as proj4 returns it, before unwrapping. */
  seedRawX: Float64Array;
  /** How seed corners 1, 2, 3 were unwrapped (corner 0 is kept as is). */
  seedUnwraps: SeedUnwrap[];
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
  /** Period of the output x axis, passed to `RasterReprojector`. */
  wrapX?: number;
};

/** Private `RasterReprojector` state that reveals the next split. */
type ReprojectorInternals = {
  _queue: number[];
  _errors: number[];
  _queueIndices: number[];
  _candidatesUV: number[];
  _candidatesOutX: number[];
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
  const { width, height, maxError, maxSteps = 10_000, wrapX } = options;
  const reprojector = new RasterReprojector(fns, width + 1, height + 1, {
    wrapX,
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
    measureTriangle(
      reprojector,
      [
        seedTriangles[3 * t]!,
        seedTriangles[3 * t + 1]!,
        seedTriangles[3 * t + 2]!,
      ],
      wrapX,
    ),
  );
  const seedVertices = reprojector.uvs.length / 2;
  const seedRawX = Float64Array.from({ length: seedVertices }, (_, i) =>
    rawOutputX(
      reprojector,
      reprojector.uvs[2 * i]!,
      reprojector.uvs[2 * i + 1]!,
    ),
  );
  const seedUnwraps =
    wrapX === undefined
      ? []
      : Array.from({ length: seedVertices - 1 }, (_, i) =>
          replayUnwrap(reprojector, i, i + 1, wrapX),
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
    const refX = internals._candidatesOutX[index] ?? guess[0];
    const rawX = rawOutputX(reprojector, ...uv);
    const vertex = reprojector.uvs.length / 2;

    reprojector.refine();

    steps.push({
      split: {
        index,
        triangle,
        uv,
        guess,
        error,
        refX,
        rawX,
        samples: measureTriangle(reprojector, triangle, wrapX),
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
    seedRawX,
    seedUnwraps,
    steps,
  };
}

/**
 * Measure a triangle's 4 test points the way `RasterReprojector` does:
 * linearly interpolate the corners' exact output positions, reproject that
 * guess back into the source image, and compare with where the point is.
 * Vertex ids stay valid after later splits, so this works on any snapshot.
 */
function measureTriangle(
  reprojector: RasterReprojector,
  [a, b, c]: [number, number, number],
  wrapX: number | undefined,
): ErrorSample[] {
  const { uvs, exactOutputPositions: out, reprojectors: fns } = reprojector;
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
    if (wrapX !== undefined) {
      exact[0] = snapToCopy(exact[0], guess[0], wrapX);
    }
    return {
      uv,
      guess,
      exact,
      error: Math.hypot(pixel[0] - sampled[0], pixel[1] - sampled[1]),
    };
  });
}

/** A UV point's exact output x straight from the reprojection, unsnapped. */
function rawOutputX(reprojector: RasterReprojector, u: number, v: number) {
  const fns = reprojector.reprojectors;
  const pixel = [u * (reprojector.width - 1), v * (reprojector.height - 1)];
  return fns.forwardReproject(...fns.forwardTransform(pixel[0]!, pixel[1]!))[0];
}

/**
 * Replay the library's `unwrapAlong` from seed vertex `from` to `vertex`,
 * logging the points it samples. Each sample is then snapped to the copy
 * nearest the one before it along the path, which is what the bisection
 * guarantees, so the last one lands on the corner's unwrapped x.
 */
function replayUnwrap(
  reprojector: RasterReprojector,
  from: number,
  vertex: number,
  wrapX: number,
): SeedUnwrap {
  const { uvs, exactOutputPositions: out, reprojectors: fns } = reprojector;
  const [u0, v0, u1, v1] = [
    uvs[2 * from]!,
    uvs[2 * from + 1]!,
    uvs[2 * vertex]!,
    uvs[2 * vertex + 1]!,
  ];
  const uvAt = (t: number): [number, number] => [
    u0 + t * (u1 - u0),
    v0 + t * (v1 - v0),
  ];
  const ts = new Set<number>();
  unwrapAlong(
    (t) => {
      ts.add(t);
      return rawOutputX(reprojector, ...uvAt(t));
    },
    out[2 * from]!,
    wrapX,
  );
  let previous = out[2 * from]!;
  const samples = [...ts]
    .sort((a, b) => a - b)
    .map((t): UnwrapSample => {
      const uv = uvAt(t);
      const pixel = [
        uv[0] * (reprojector.width - 1),
        uv[1] * (reprojector.height - 1),
      ];
      const [rawX, y] = fns.forwardReproject(
        ...fns.forwardTransform(pixel[0]!, pixel[1]!),
      );
      previous = snapToCopy(rawX, previous, wrapX);
      return { t, uv, rawX, x: previous, y };
    });
  return { vertex, from, samples };
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
  options: { width: number; height: number; maxError: number; wrapX?: number },
): number {
  const reprojector = new RasterReprojector(
    fns,
    options.width + 1,
    options.height + 1,
    { wrapX: options.wrapX },
  );
  reprojector.run(options.maxError);
  return reprojector.triangles.length / 3;
}
