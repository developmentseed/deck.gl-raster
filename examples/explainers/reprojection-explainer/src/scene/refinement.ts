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

/** One test point of a triangle, measured the way the library does. */
export type ErrorSample = {
  /** Texture coordinate of the point (0–1, v down). */
  uv: [number, number];
  /** Where the GPU draws it: the linear guess from the corners (target CRS). */
  guess: [number, number];
  /** Where it really belongs: its exact reprojection (target CRS). */
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
  _queueIndices: number[];
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
 * linearly interpolate the corners' exact output positions, reproject that
 * guess back into the source image, and compare with where the point is.
 * Vertex ids stay valid after later splits, so this works on any snapshot.
 */
function measureTriangle(
  reprojector: RasterReprojector,
  [a, b, c]: [number, number, number],
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
    return {
      uv,
      guess,
      exact,
      error: Math.hypot(pixel[0] - sampled[0], pixel[1] - sampled[1]),
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

/** One edge flip the refinement made, for showing on its own. */
export type FlipExample = {
  /** Index of the refinement step whose split triggered the flip. */
  step: number;
  /** The split's new vertex. */
  vertex: number;
  /** The shared edge before the flip, `u`–`w`. */
  from: [number, number];
  /** The shared edge after the flip: the new vertex to `x`. */
  to: [number, number];
  /**
   * The mesh after the step, but with the flip undone: the two flipped
   * triangles swapped for the thin pair the split made.
   */
  before: Uint32Array;
  /** Indices of the two flipped triangles, in `before` and in the step's mesh. */
  triangles: [number, number];
};

/**
 * The first refinement step that made exactly one edge flip, and where that
 * flip makes the pair's thinnest angle (in source pixels) clearly bigger.
 * Null if no step qualifies.
 */
export function findFlip(
  record: RefinementRecord,
  width: number,
  height: number,
): FlipExample | null {
  const px = (v: number): [number, number] => [
    record.uvs[2 * v]! * width,
    record.uvs[2 * v + 1]! * height,
  ];
  for (let k = 0; k < record.steps.length; k++) {
    const step = record.steps[k]!;
    const p = step.vertex;
    const beforeMesh =
      k === 0 ? record.seedTriangles : record.steps[k - 1]!.triangles;
    const afterMesh = step.triangles;
    const afterEdges = edgeSet(afterMesh);

    // The triangles the split cut: the split triangle, plus its neighbour
    // across the split edge when the new vertex sits on an edge.
    const [a, b, c] = step.split.triangle;
    const weights = barycentric(
      step.split.uv,
      px01(record, a),
      px01(record, b),
      px01(record, c),
    );
    const cut = [step.split.index];
    const zero = weights.findIndex((w) => Math.abs(w) < 1e-9);
    if (zero >= 0) {
      const [u0, w0] = [a, b, c].filter((_, i) => i !== zero) as [
        number,
        number,
      ];
      const across = trianglesWithEdge(beforeMesh, u0, w0).find(
        (t) => t !== step.split.index,
      );
      if (across !== undefined) {
        cut.push(across);
      }
    }

    // Each outer edge of the cut triangles faces the new vertex. It was
    // flipped if it's gone and the new vertex now reaches across it.
    const flips: { u: number; w: number; x: number }[] = [];
    let naiveCount = 0;
    for (const t of cut) {
      const tri = [
        beforeMesh[3 * t]!,
        beforeMesh[3 * t + 1]!,
        beforeMesh[3 * t + 2]!,
      ];
      for (let i = 0; i < 3; i++) {
        const u = tri[i]!;
        const w = tri[(i + 1) % 3]!;
        const onSplitEdge = zero >= 0 && isSplitEdge(u, w, [a, b, c], zero);
        if (onSplitEdge) {
          continue;
        }
        naiveCount++;
        const outer = trianglesWithEdge(beforeMesh, u, w).find(
          (o) => !cut.includes(o),
        );
        if (outer === undefined) {
          continue;
        }
        const x = [0, 1, 2]
          .map((j) => beforeMesh[3 * outer + j]!)
          .find((v) => v !== u && v !== w)!;
        if (!afterEdges.has(edgeKey(u, w)) && afterEdges.has(edgeKey(p, x))) {
          flips.push({ u, w, x });
        }
      }
    }
    // One flip and no cascade: the new vertex has exactly one extra triangle.
    if (flips.length !== 1 || countUsing(afterMesh, p) !== naiveCount + 1) {
      continue;
    }
    const { u, w, x } = flips[0]!;
    const pair = [0, 1]
      .map((i) => (i === 0 ? u : w))
      .map((end) => findTriangle(afterMesh, [p, x, end]));
    if (pair.some((t) => t < 0)) {
      continue;
    }
    const thin = Math.min(
      minAngle(px(p), px(u), px(w)),
      minAngle(px(u), px(w), px(x)),
    );
    const fat = Math.min(
      minAngle(px(p), px(x), px(u)),
      minAngle(px(p), px(x), px(w)),
    );
    if (fat < thin * 1.5) {
      continue;
    }
    const before = Uint32Array.from(afterMesh);
    before.set([p, u, w], 3 * pair[0]!);
    before.set([u, x, w], 3 * pair[1]!);
    return {
      step: k,
      vertex: p,
      from: [u, w],
      to: [p, x],
      before,
      triangles: [pair[0]!, pair[1]!],
    };
  }
  return null;
}

function px01(record: RefinementRecord, v: number): [number, number] {
  return [record.uvs[2 * v]!, record.uvs[2 * v + 1]!];
}

/** Whether `u`–`w` is the edge of `[a, b, c]` opposite corner `zero`. */
function isSplitEdge(
  u: number,
  w: number,
  tri: [number, number, number],
  zero: number,
): boolean {
  const [e0, e1] = tri.filter((_, i) => i !== zero) as [number, number];
  return edgeKey(u, w) === edgeKey(e0, e1);
}

function edgeKey(a: number, b: number): number {
  return Math.min(a, b) * 1_000_000 + Math.max(a, b);
}

function edgeSet(triangles: Uint32Array): Set<number> {
  const set = new Set<number>();
  for (let t = 0; t < triangles.length; t += 3) {
    for (let i = 0; i < 3; i++) {
      set.add(edgeKey(triangles[t + i]!, triangles[t + ((i + 1) % 3)]!));
    }
  }
  return set;
}

function trianglesWithEdge(
  triangles: Uint32Array,
  u: number,
  w: number,
): number[] {
  const out: number[] = [];
  for (let t = 0; t < triangles.length / 3; t++) {
    const tri = [triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]];
    if (tri.includes(u) && tri.includes(w)) {
      out.push(t);
    }
  }
  return out;
}

function countUsing(triangles: Uint32Array, v: number): number {
  let count = 0;
  for (let i = 0; i < triangles.length; i++) {
    if (triangles[i] === v) {
      count++;
    }
  }
  return count;
}

function findTriangle(triangles: Uint32Array, corners: number[]): number {
  for (let t = 0; t < triangles.length / 3; t++) {
    const tri = [triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]];
    if (corners.every((v) => tri.includes(v))) {
      return t;
    }
  }
  return -1;
}

/** Smallest interior angle of a triangle, in radians. */
export function minAngle(
  a: [number, number],
  b: [number, number],
  c: [number, number],
): number {
  const angle = (
    p: [number, number],
    q: [number, number],
    r: [number, number],
  ) =>
    Math.abs(
      Math.atan2(
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]),
        (q[0] - p[0]) * (r[0] - p[0]) + (q[1] - p[1]) * (r[1] - p[1]),
      ),
    );
  return Math.min(angle(a, b, c), angle(b, c, a), angle(c, a, b));
}
