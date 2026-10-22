import type { Mesh2D } from "@developmentseed/deck.gl-raster/internal/clip-mesh-to-world.js";
import { clipMeshToWorld } from "@developmentseed/deck.gl-raster/internal/clip-mesh-to-world.js";
import { makeUnwrappedReprojectionFns } from "@developmentseed/deck.gl-raster/internal/make-unwrapped-reprojection-fns.js";
import { nearestCopy } from "@developmentseed/proj";
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
 * How close a walk's last point comes to its corner, in pixels: the library
 * stops just short of each corner, because a corner can be a pole.
 */
const CORNER_TOLERANCE = 1e-3;

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
  /** How far along the walk, as a fraction of the way to the corner. */
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
  /** The corner's unwrapped x: the last sample's. */
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
  options: {
    width: number;
    height: number;
    /** The unwrap to call: the library's, unless a test stands one in. */
    unwrap?: typeof makeUnwrappedReprojectionFns;
  },
): MeshScene {
  const { fns } = projection;
  const { width, height, unwrap = makeUnwrappedReprojectionFns } = options;
  // Record every pixel the unwrap projects while it walks to the corners:
  // those are the walks step 5 draws, as the library takes them.
  const requested: [number, number][] = [];
  let recording = true;
  const wrapped = unwrap(
    {
      ...fns,
      forwardTransform: (px, py) => {
        if (recording) {
          requested.push([px, py]);
        }
        return fns.forwardTransform(px, py);
      },
    },
    { width, height, period: PERIOD },
  );
  recording = false;
  const at = (f: ReprojectionFns, px: number, py: number) =>
    f.forwardReproject(...f.forwardTransform(px, py));
  const uvOf = (px: number, py: number): [number, number] => [
    px / width,
    py / height,
  ];

  const pixels = cornerPixels(width, height);
  const { start, walks: walkPixels } = splitWalks(requested, pixels);
  const center = { uv: uvOf(...start), position: at(fns, ...start) };

  const corners = {} as MeshScene["corners"];
  const walks = {} as MeshScene["walks"];
  for (const id of CORNER_IDS) {
    const [px, py] = pixels[id];
    corners[id] = {
      uv: uvOf(px, py),
      raw: at(fns, px, py),
      unwrapped: at(wrapped, px, py),
    };
    walks[id] = walkFrom({
      pixels: walkPixels[id],
      start,
      corner: [px, py],
      startX: center.position[0],
      positionAt: (x, y) => at(fns, x, y),
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
 * Split the pixels an unwrap projected into its start and one walk per corner.
 * Each walk ends where it reaches its corner; a walk that halves its steps can
 * reach the corner more than once, so those pieces join.
 */
function splitWalks(
  requested: [number, number][],
  corners: Record<CornerId, [number, number]>,
): { start: [number, number]; walks: Record<CornerId, [number, number][]> } {
  const [start, ...rest] = requested;
  if (!start) {
    throw new Error("The unwrap projected no points.");
  }
  const walks = {} as Record<CornerId, [number, number][]>;
  let current: [number, number][] = [];
  for (const pixel of rest) {
    current.push(pixel);
    const reached = CORNER_IDS.find(
      (id) =>
        Math.hypot(pixel[0] - corners[id][0], pixel[1] - corners[id][1]) <
        CORNER_TOLERANCE,
    );
    if (reached) {
      walks[reached] = [...(walks[reached] ?? []), ...current];
      current = [];
    }
  }
  const missing = CORNER_IDS.filter((id) => !walks[id]);
  if (missing.length > 0 || current.length > 0) {
    throw new Error(
      `The unwrap's walks didn't each end at a corner (missing: ${missing.join(", ") || "none"}).`,
    );
  }
  return { start, walks };
}

/**
 * One walk's samples, in order along it, each moved to the copy nearest the
 * one before it, as `unwrapAlong` moves them.
 */
function walkFrom(options: {
  pixels: [number, number][];
  start: [number, number];
  corner: [number, number];
  startX: number;
  positionAt: (px: number, py: number) => [number, number];
  size: [number, number];
}): Walk {
  const { pixels, start, corner, startX, positionAt, size } = options;
  const length = Math.hypot(corner[0] - start[0], corner[1] - start[1]);
  const distance = ([px, py]: [number, number]) =>
    Math.hypot(px - start[0], py - start[1]);
  const unique = [
    ...new Map(pixels.map((p) => [`${p[0]},${p[1]}`, p])).values(),
  ];
  let previous = startX;
  const samples = unique
    .sort((a, b) => distance(a) - distance(b))
    .map((pixel): WalkSample => {
      const [raw, y] = positionAt(...pixel);
      previous = nearestCopy(raw, previous, PERIOD);
      return {
        t: distance(pixel) / length,
        uv: [pixel[0] / size[0], pixel[1] / size[1]],
        raw,
        y,
        x: previous,
      };
    });
  return { samples, end: previous };
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
