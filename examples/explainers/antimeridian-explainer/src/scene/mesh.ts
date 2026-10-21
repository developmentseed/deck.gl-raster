import type { Mesh2D } from "@developmentseed/deck.gl-raster/internal/clip-mesh-to-world.js";
import { clipMeshToWorld } from "@developmentseed/deck.gl-raster/internal/clip-mesh-to-world.js";
import { makeUnwrappedReprojectionFns } from "@developmentseed/deck.gl-raster/internal/make-unwrapped-reprojection-fns.js";
import { nearestCopy, unwrapAlong } from "@developmentseed/proj";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { RasterReprojector } from "@developmentseed/raster-reproject";
import { MAX_ERROR, PERIOD } from "./constants.js";
import type { Projection } from "./projection.js";
import type { RefinementRecord } from "./refinement.js";
import { recordRefinement } from "./refinement.js";

/** One of the image's corners. */
export type CornerId = "nw" | "ne" | "sw" | "se";

/** The corners, in the order the steps list them. */
export const CORNER_IDS: CornerId[] = ["nw", "ne", "sw", "se"];

/** Each corner's pixel position, in an image of `width` x `height`. */
export function cornerPixels(
  width: number,
  height: number,
): Record<CornerId, [number, number]> {
  return { nw: [0, 0], ne: [width, 0], sw: [0, height], se: [width, height] };
}

/**
 * How far `makeUnwrappedReprojectionFns` walks toward each corner: just short
 * of it, because a corner can be a pole. Copied from
 * `packages/deck.gl-raster/src/make-unwrapped-reprojection-fns.ts`; a test
 * checks that each walk ends where the real wrapped functions put its corner.
 */
const INSIDE_CORNER = 1 - 1e-6;

/**
 * The refines `RasterReprojector.run` makes before it gives up: its loop
 * refines, then stops once its count passes 10,000.
 */
const PLAIN_REFINES = 10_001;

/** Triangle counts the time-lapse of the plain refinement shows. */
const SNAPSHOT_COUNTS = [2, 8, 32, 128, 512, 2048, 8192];

/** How many points the probe samples across the image. */
const PROBE_SAMPLES = 120;

/** How finely the 180° meridian is traced, in degrees of latitude. */
const MERIDIAN_STEP = 0.05;

/** One point a walk samples, on its way to a corner. */
export type WalkSample = {
  /** How far along the walk, from 0 (the center) to 1 (the corner). */
  t: number;
  /** Where in the image, 0-1 with v down. */
  uv: [number, number];
  /** Its x as proj4 returns it, in one world. */
  raw: number;
  /** Its y, the same in every copy of the world. */
  y: number;
  /** Its x moved to the copy nearest the sample before it. */
  x: number;
};

/** The walk from the image's center to one corner, as `unwrapAlong` takes it. */
export type Walk = {
  /** The samples, in order along the walk. */
  samples: WalkSample[];
  /** `unwrapAlong`'s answer: the corner's unwrapped x. */
  end: number;
};

/** The mesh at one moment of a refinement. */
export type Snapshot = {
  /** Vertex ids, 3 per triangle. */
  triangles: Uint32Array;
  /** Output positions in common space, 2 per vertex. */
  positions: Float64Array;
  /** Texture coordinates, 0-1 with v down, 2 per vertex. */
  uvs: Float64Array;
  /** The largest error left, in output pixels. */
  maxError: number;
};

/** One point of the probe that sweeps across the image. */
export type ProbeSample = {
  /** Where in the image, 0-1 with v down. */
  uv: [number, number];
  /** Where proj4 puts it, in common space. */
  raw: [number, number];
  /** Where the wrapped functions put it: the copy nearest the corners' blend. */
  snapped: [number, number];
};

/** Everything the story draws, computed once with the library's functions. */
export type MeshScene = {
  /** The image's center, where every walk starts. */
  center: { uv: [number, number]; position: [number, number] };
  /** Each corner, as proj4 projects it and as the wrapped functions do. */
  corners: Record<
    CornerId,
    { uv: [number, number]; raw: [number, number]; unwrapped: [number, number] }
  >;
  /** The walk to each corner. */
  walks: Record<CornerId, Walk>;
  /** The plain projection's refinement, at a few triangle counts; the last is where it stops. */
  plain: Snapshot[];
  /** The snapped projection's refinement, split by split. */
  refinement: RefinementRecord;
  /** The snapped projection's final mesh, before the cut. */
  mesh: Mesh2D;
  /** Indices of the mesh's triangles that cross x 0, the world's west edge. */
  crossing: number[];
  /** The mesh cut at the world's edge, as `RasterLayer` draws it. */
  clipped: Mesh2D;
  /** The probe's samples, west to east along the image's middle row. */
  probe: ProbeSample[];
  /** The 180° meridian through the image, in texture coordinates. */
  meridian: [number, number][];
};

/**
 * Compute everything the story draws, calling the functions `RasterLayer`
 * calls, in its order: `makeUnwrappedReprojectionFns` with the image's size,
 * `RasterReprojector` with one more row and column, then `clipMeshToWorld`.
 */
export function buildMeshScene(
  projection: Projection,
  options: { width: number; height: number },
): MeshScene {
  const { fns } = projection;
  const { width, height } = options;
  const wrapped = makeUnwrappedReprojectionFns(fns, {
    width,
    height,
    period: PERIOD,
  });
  const at = (f: ReprojectionFns, px: number, py: number) =>
    f.forwardReproject(...f.forwardTransform(px, py));
  const uvOf = (px: number, py: number): [number, number] => [
    px / width,
    py / height,
  ];

  const centerPixel: [number, number] = [width / 2, height / 2];
  const center = {
    uv: uvOf(...centerPixel),
    position: at(fns, ...centerPixel),
  };

  const pixels = cornerPixels(width, height);
  const corners = {} as MeshScene["corners"];
  const walks = {} as MeshScene["walks"];
  for (const id of CORNER_IDS) {
    const [px, py] = pixels[id];
    corners[id] = {
      uv: uvOf(px, py),
      raw: at(fns, px, py),
      unwrapped: at(wrapped, px, py),
    };
    walks[id] = recordWalk({
      positionAt: (x, y) => at(fns, x, y),
      from: centerPixel,
      to: [px, py],
      start: center.position[0],
      size: [width, height],
    });
  }

  const refinement = recordRefinement(wrapped, {
    width,
    height,
    maxError: MAX_ERROR,
    errorSpace: "output",
  });
  const finalTriangles =
    refinement.steps[refinement.steps.length - 1]?.triangles ??
    refinement.seedTriangles;
  const mesh: Mesh2D = {
    positions: Array.from(refinement.positions),
    uvs: Array.from(refinement.uvs),
    triangles: Array.from(finalTriangles),
  };

  return {
    center,
    corners,
    walks,
    plain: plainSnapshots(fns, { width, height }),
    refinement,
    mesh,
    crossing: crossingTriangles(mesh),
    clipped: clipMeshToWorld(mesh, PERIOD),
    probe: Array.from({ length: PROBE_SAMPLES }, (_, i) => {
      const u = i / (PROBE_SAMPLES - 1);
      const px = u * width;
      const py = height / 2;
      return {
        uv: uvOf(px, py),
        raw: at(fns, px, py),
        snapped: at(wrapped, px, py),
      };
    }),
    meridian: traceMeridian(projection, { width, height }),
  };
}

/**
 * Walk from `from` toward `to` (in pixels) with `unwrapAlong`, along the path
 * `makeUnwrappedReprojectionFns` takes, recording every sample it asks for.
 */
function recordWalk(options: {
  positionAt: (px: number, py: number) => [number, number];
  from: [number, number];
  to: [number, number];
  start: number;
  size: [number, number];
}): Walk {
  const { positionAt, from, to, start, size } = options;
  const calls: Omit<WalkSample, "x">[] = [];
  const end = unwrapAlong(
    (t) => {
      const px = from[0] + t * INSIDE_CORNER * (to[0] - from[0]);
      const py = from[1] + t * INSIDE_CORNER * (to[1] - from[1]);
      const [raw, y] = positionAt(px, py);
      calls.push({ t, uv: [px / size[0], py / size[1]], raw, y });
      return raw;
    },
    { start, period: PERIOD },
  );
  // In path order, each sample moves to the copy nearest the one before it,
  // as `unwrapAlong` moves it.
  let previous = start;
  const samples = [...calls]
    .sort((a, b) => a.t - b.t)
    .map((sample) => {
      previous = nearestCopy(sample.raw, previous, PERIOD);
      return { ...sample, x: previous };
    });
  return { samples, end };
}

/**
 * Refine the plain projection, as `RasterReprojector.run` would, and keep the
 * mesh at a few triangle counts and where it stops.
 */
function plainSnapshots(
  fns: ReprojectionFns,
  options: { width: number; height: number },
): Snapshot[] {
  const reprojector = new RasterReprojector(
    fns,
    options.width + 1,
    options.height + 1,
    { _errorSpace: "output" },
  );
  const snapshot = (): Snapshot => ({
    triangles: Uint32Array.from(reprojector.triangles),
    positions: Float64Array.from(reprojector.exactOutputPositions),
    uvs: Float64Array.from(reprojector.uvs),
    maxError: reprojector.getMaxError(),
  });
  const snapshots: Snapshot[] = [];
  let next = 0;
  for (let refines = 0; ; refines++) {
    const count = reprojector.triangles.length / 3;
    if (next < SNAPSHOT_COUNTS.length && count >= SNAPSHOT_COUNTS[next]!) {
      snapshots.push(snapshot());
      while (next < SNAPSHOT_COUNTS.length && count >= SNAPSHOT_COUNTS[next]!) {
        next++;
      }
    }
    if (refines >= PLAIN_REFINES || reprojector.getMaxError() <= MAX_ERROR) {
      break;
    }
    reprojector.refine();
  }
  snapshots.push(snapshot());
  return snapshots;
}

/** Indices of the triangles with corners on both sides of x 0. */
function crossingTriangles(mesh: Mesh2D): number[] {
  const crossing: number[] = [];
  for (let t = 0; t < mesh.triangles.length / 3; t++) {
    const xs = [0, 1, 2].map(
      (k) => mesh.positions[2 * mesh.triangles[3 * t + k]!]!,
    );
    if (Math.min(...xs) < 0 && Math.max(...xs) > 0) {
      crossing.push(t);
    }
  }
  return crossing;
}

/**
 * The 180° meridian in the image's texture coordinates: points along it,
 * projected into the image, kept where they fall inside it.
 */
function traceMeridian(
  projection: Projection,
  options: { width: number; height: number },
): [number, number][] {
  const { fns, toLngLat, fromLngLat } = projection;
  const { width, height } = options;
  const latitudes = Object.values(cornerPixels(width, height)).map(
    ([px, py]) => toLngLat(...fns.forwardTransform(px, py))[1],
  );
  const south = Math.floor(Math.min(...latitudes)) - 1;
  const north = Math.ceil(Math.max(...latitudes)) + 1;
  const points: [number, number][] = [];
  for (let lat = south; lat <= north; lat += MERIDIAN_STEP) {
    const [px, py] = fns.inverseTransform(...fromLngLat(180, lat));
    const u = px / width;
    const v = py / height;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      points.push([u, v]);
    }
  }
  return points;
}
