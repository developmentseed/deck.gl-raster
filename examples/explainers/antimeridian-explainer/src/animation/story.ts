import type { TriangleSoup } from "../layers/triangle-soup.js";
import type { Scene } from "../scene/build-scene.js";
import { LIBRARY_DEFAULT_MAX_ERROR } from "../scene/build-scene.js";
import type { Polyline } from "../scene/lines.js";
import type { ErrorSample } from "../scene/refinement.js";
import { UTM_PIXEL_KM, WORLD_WIDTH } from "../scene/utm60n.js";
import type { FlightOptions, FlightPaths, FlightStyle } from "./flight.js";
import { eastFirstDelays, flightDuration, flightPositions } from "./flight.js";
import type {
  DotDraw,
  Frame,
  Hud,
  Label,
  LineDraw,
  MeshDraw,
  Rgba,
} from "./frame.js";
import { clamp01, easeInOutCubic, lerp, progress } from "./math.js";
import type { ScheduleOptions } from "./refine-schedule.js";
import {
  DEFAULT_SCHEDULE,
  scheduleRefinement,
  stepAt,
} from "./refine-schedule.js";
import type { UnitColor } from "./soup.js";
import { centroidsX, createSoup, expandByCorner, tintsFor } from "./soup.js";

/** Settings the presenter can tune. */
export type StorySettings = {
  /** How triangles travel in the "project the corners" and "map" steps. */
  flightStyle: FlightStyle;
  /** Time each triangle spends in the air, in ms. */
  flightMs: number;
  /** Peak height of each triangle's arc, in slide units. */
  arcHeight: number;
  /** Pacing of the refinement replay. */
  schedule: ScheduleOptions;
};

/** Default story settings. */
export const DEFAULT_STORY_SETTINGS: StorySettings = {
  flightStyle: "direct",
  flightMs: 1400,
  arcHeight: 40,
  schedule: DEFAULT_SCHEDULE,
};

/** Ids of the story's steps, in order. */
export type StoryStepId =
  | "start"
  | "cut"
  | "wrapped-corners"
  | "unwrap"
  | "refine"
  | "fly-over"
  | "result";

/** A run of description text: plain, emphasized, or a link. */
export type TextRun =
  | string
  | { text: string; emphasis: true }
  | { text: string; href: string };

/** Options for {@link StoryStep.frame}. */
export type FrameOptions = {
  /**
   * The player is paused (for example by the slider), so show the dots that
   * fast playback hides to avoid flicker.
   */
  paused?: boolean;
};

/** Maps slider positions to times in a step, and back. */
export type Scrubber = {
  /** Number of slider positions, numbered 0 to `count - 1`. */
  count: number;
  /** Text for a slider position, e.g. "17 / 30 splits". */
  label(position: number): string;
  /** Time in the step to pause at for a slider position, in ms. */
  timeAt(position: number): number;
  /** The slider position for a time in the step. */
  positionAt(timeMs: number): number;
};

/** One step of the story. */
export type StoryStep = {
  /** Stable id. */
  id: StoryStepId;
  /** Title shown at the top of the slide. */
  title: string;
  /** What happens in this step, for viewers without a narrator. */
  description: TextRun[];
  /** Length of the step's animation in ms; 0 for a still. */
  durationMs: number;
  /** A slider for scrubbing through the step, if it has one. */
  scrubber?: Scrubber;
  /** What to draw `timeMs` into the step, for 0 ≤ `timeMs` ≤ `durationMs`. */
  frame(timeMs: number, options?: FrameOptions): Frame;
};

/** Colour of the 180° meridian baked into the texture. */
export const MERIDIAN_COLOR = "#ff5a5a";

const REPROJECTION_EXPLAINER =
  "https://developmentseed.org/deck.gl-raster/examples/reprojection-explainer/";
const PULL_REQUEST =
  "https://github.com/developmentseed/deck.gl-raster/pull/673";

const SOURCE_EDGES: Rgba = [255, 255, 255, 200];
const TARGET_EDGES: Rgba = [255, 255, 255, 150];
const EDGE_WIDTH = 0.75;
const RED: Rgba = [255, 69, 58, 255];
const GREEN: Rgba = [48, 209, 88, 255];
const TRUTH: Rgba = [255, 255, 255, 230];
const OUTLINE: Rgba = [255, 255, 255, 110];
const SLOTS: Rgba = [255, 255, 255, 70];
const PATH: Rgba = [255, 255, 255, 220];
/** Tint of the triangle about to be split. */
const HIGHLIGHT: UnitColor = [1, 0.62, 0.04, 0.55];
/** Tint of a triangle with the worst score; others are fainter. */
const HEAT: UnitColor = [1, 0.27, 0.23, 0.3];
/** Tint of the triangles a split just made. */
const FRESH: UnitColor = [1, 0.62, 0.04, 0.2];
const DOT_RADIUS = 7;
const HEAT_CAPTION =
  "Shading shows each triangle's score. The worst (orange) is split next.";
const WRAPPED_CAPTION =
  "proj4 put this vertex a world away. It snaps to the copy nearest the red dot.";
const SAMPLE: Rgba = [255, 255, 255, 255];
const SAMPLE_RADIUS = 4;

const CUT_MS = 900;
const FIRST_SPREAD_MS = 250;
const FINAL_SPREAD_MS = 1200;
const CLEAR_MS = 500;
const SNAP_DELAY_MS = 300;
const SNAP_MS = 1200;
const RESULT_MS = 1200;
/** Unwrap step: time per seed corner, and its phases within that. */
const CORNER_MS = 2200;
const CORNER_PATH_MS = 400;
const CORNER_SAMPLE_GAP_MS = 500;
const CORNER_MOVE_MS = 600;
const UNWRAP_START_MS = 300;
const ZOOM_MS = 1400;
/** Refinement steps shorter than this hide their dots, to avoid flicker. */
const DOTS_MIN_STEP_MS = 150;

/** Names of the seed corners, by vertex id (texture coordinates 0,0 to 1,1). */
const CORNER_NAMES = ["top-left", "top-right", "bottom-left", "bottom-right"];

/**
 * The seven steps of the explainer, each a pure function from time to a
 * {@link Frame}:
 *
 * 1. `start`: the source image, and the whole Web Mercator world.
 * 2. `cut`: the 2-triangle seed's edges appear.
 * 3. `wrapped-corners`: the 2 triangles fly to the corners proj4 returns,
 *    which straddle the world, so they stretch across it.
 * 4. `unwrap`: each seed corner is unwrapped along the path from the one
 *    before (`unwrapAlong`), then the view zooms in on the mesh.
 * 5. `refine`: replay of `refine()`, each new vertex snapped to its parent's
 *    interpolated x (`snapToCopy`).
 * 6. `fly-over`: every final triangle flies into its slot.
 * 7. `result`: the edges fade; the mesh runs past 180°.
 */
export function createStory(
  scene: Scene,
  settings: StorySettings,
): StoryStep[] {
  const { layout, worldLayout, record } = scene;
  const finalK = record.steps.length;
  const flight: FlightOptions = {
    style: settings.flightStyle,
    durationMs: settings.flightMs,
    arcHeight: settings.arcHeight,
    snapDelayMs: SNAP_DELAY_MS,
    snapDurationMs: SNAP_MS,
  };

  // Snapshot `k` is the mesh after `k` refinement steps (0 is the seed).
  const trianglesAt = (k: number): Uint32Array =>
    k === 0 ? record.seedTriangles : record.steps[k - 1]!.triangles;
  const triangleCount = (k: number): number => trianglesAt(k).length / 3;
  const scoresAt = (k: number): Float32Array =>
    k === 0 ? record.seedScores : record.steps[k - 1]!.scores;
  /** Shade by score relative to the worst: brighter is worse. */
  const heat = (k: number, triangle: number): UnitColor =>
    scaleAlpha(HEAT, scoresAt(k)[triangle]! / maxErrorAt(k));
  const maxErrorAt = (k: number): number =>
    k === 0 ? record.seedMaxError : record.steps[k - 1]!.maxError;

  const at = (positions: Float32Array, vertex: number): [number, number] => [
    positions[2 * vertex]!,
    positions[2 * vertex + 1]!,
  ];
  const vertexTarget = (vertex: number) => at(scene.targetXY, vertex);
  const guessAt = (k: number) => at(scene.guessXY, k);

  const soups = new Map<string, TriangleSoup>();
  const soup = (panel: "source" | "target", k: number): TriangleSoup => {
    const key = `${panel}:${k}`;
    let cached = soups.get(key);
    if (!cached) {
      cached = createSoup({
        triangles: trianglesAt(k),
        positions: panel === "source" ? scene.sourceXY : scene.targetXY,
        uvs: record.uvs,
      });
      soups.set(key, cached);
    }
    return cached;
  };
  const tinted = (
    base: TriangleSoup,
    k: number,
    tintOf: (triangle: number) => UnitColor | null,
  ): TriangleSoup => ({ ...base, tints: tintsFor(triangleCount(k), tintOf) });
  /** The seed mesh with each vertex placed by `place`. */
  const seedWith = (
    place: (vertex: number) => [number, number],
  ): TriangleSoup => {
    const positions = new Float32Array(scene.targetXY.length);
    for (let v = 0; v < positions.length / 2; v++) {
      positions.set(place(v), 2 * v);
    }
    return {
      ...soup("target", 0),
      positions: expandByCorner(record.seedTriangles, positions, 2),
    };
  };

  /** The target mesh after `k` steps, with one vertex moved to `xy`. */
  const targetWithVertex = (
    k: number,
    vertex: number,
    xy: [number, number],
  ): TriangleSoup => {
    const positions = Float32Array.from(scene.targetXY);
    positions[2 * vertex] = xy[0];
    positions[2 * vertex + 1] = xy[1];
    return {
      ...soup("target", k),
      positions: expandByCorner(trianglesAt(k), positions, 2),
    };
  };

  const freshTriangles = new Map<number, Set<number>>();
  /** Triangles of snapshot `k` that use `vertex`: the ones a split just made. */
  const trianglesUsing = (k: number, vertex: number): Set<number> => {
    let set = freshTriangles.get(k);
    if (!set) {
      set = new Set();
      const triangles = trianglesAt(k);
      for (let t = 0; t < triangles.length / 3; t++) {
        if (
          triangles[3 * t] === vertex ||
          triangles[3 * t + 1] === vertex ||
          triangles[3 * t + 2] === vertex
        ) {
          set.add(t);
        }
      }
      freshTriangles.set(k, set);
    }
    return set;
  };

  const makeFlight = (
    k: number,
    spreadMs: number,
    target: Float32Array,
    copy: Float32Array,
  ) => {
    const triangles = trianglesAt(k);
    const paths: FlightPaths = {
      source: expandByCorner(triangles, scene.sourceXY, 2),
      copy: expandByCorner(triangles, copy, 2),
      target: expandByCorner(triangles, target, 2),
    };
    const delays = eastFirstDelays(centroidsX(paths.source), spreadMs);
    const base = soup("target", k);
    return {
      durationMs: flightDuration(delays, flight),
      soupAt: (timeMs: number): TriangleSoup => ({
        ...base,
        positions: flightPositions(paths, delays, timeMs, flight),
      }),
    };
  };

  // Lines on the target panel. `zoom` blends the world view (0) into the
  // view of the footprint (1); the −180° edge is only in the world view.
  const outlineAt = (zoom: number): Polyline =>
    zoom <= 0
      ? scene.outlineWorld
      : zoom >= 1
        ? scene.outlineTarget
        : lerpLine(scene.outlineWorld, scene.outlineTarget, zoom);
  const eastEdgeAt = (zoom: number): Polyline =>
    zoom <= 0
      ? scene.edgesWorld[0]
      : zoom >= 1
        ? scene.meridianTarget
        : lerpLine(scene.edgesWorld[0], scene.meridianTarget, zoom);
  const truthOutline = (alpha: number, zoom: number): LineDraw => ({
    id: "truth-outline",
    paths: [outlineAt(zoom)],
    color: withAlpha(OUTLINE, alpha),
    width: 1.5,
    dashed: true,
    under: false,
  });
  const edges = (zoom: number): LineDraw[] => [
    {
      id: "edge-east",
      paths: [eastEdgeAt(zoom)],
      color: TRUTH,
      width: 2,
      dashed: true,
      under: false,
    },
    ...(zoom < 1
      ? [
          {
            id: "edge-west",
            paths: [scene.edgesWorld[1]],
            color: withAlpha(TRUTH, 1 - zoom),
            width: 2,
            dashed: true,
            under: false,
          },
        ]
      : []),
  ];
  const worldLines = (outline: number): LineDraw[] => [
    ...(outline > 0 ? [truthOutline(outline, 0)] : []),
    ...edges(0),
  ];
  const localLines: LineDraw[] = [truthOutline(1, 1), ...edges(1)];
  const slotPaths = uniqueEdges(trianglesAt(finalK)).map(
    ([a, b]): [number, number][] => [vertexTarget(a), vertexTarget(b)],
  );
  const slots = (alpha: number): LineDraw => ({
    id: "slots",
    paths: slotPaths,
    color: withAlpha(SLOTS, alpha),
    width: 1,
    dashed: false,
    under: true,
  });

  // Where the meridian meets the top of the image.
  const sourceTop = scene.meridianSource.reduce((a, b) =>
    Math.abs(b[1] - layout.source.y) < Math.abs(a[1] - layout.source.y) ? b : a,
  );
  const labelsAt = (zoom: number): Label[] => {
    const east = eastEdgeAt(zoom)[1]!;
    const west = scene.edgesWorld[1][1]!;
    return [
      {
        id: "meridian-source",
        text: "180°",
        x: sourceTop[0] + 10,
        y: sourceTop[1] + 22,
        align: "left",
        color: MERIDIAN_COLOR,
        opacity: 1,
      },
      {
        id: "edge-east",
        text: zoom >= 1 ? "180°" : "+180°",
        // Above the world edge; beside the meridian, inside the image, once
        // zoomed in, clear of the panel subtitle.
        x: east[0] + 34 * zoom,
        y: east[1] + lerp(-20, 22, zoom),
        align: "center",
        color: "#ffffff",
        opacity: 1,
      },
      {
        id: "edge-west",
        text: "−180°",
        x: west[0],
        y: west[1] - 20,
        align: "center",
        color: "#ffffff",
        opacity: 1 - zoom,
      },
    ];
  };
  const worldLabels = labelsAt(0);
  const localLabels = labelsAt(1);
  const hud = (
    counter: string | null,
    caption: string | null = null,
    labels: Label[] = localLabels,
  ): Hud => ({ counter, caption, labels });

  const mesh = (
    id: string,
    triangles: TriangleSoup,
    edgeColor: Rgba,
    opacity = 1,
  ): MeshDraw => ({
    id,
    soup: triangles,
    edgeColor,
    edgeWidth: EDGE_WIDTH,
    opacity,
  });

  /** Red dot at the split point on both panels, green dot at its exact spot. */
  const splitDots = (
    k: number,
    alpha: number,
    pin: [number, number],
    arrived: number,
  ): DotDraw[] => {
    const step = record.steps[k];
    if (!step || alpha <= 0) {
      return [];
    }
    return [
      {
        id: "split-source",
        points: [layout.uvToSource(...step.split.uv)],
        color: withAlpha(RED, alpha),
        radius: DOT_RADIUS,
      },
      {
        id: "split-exact",
        points: [vertexTarget(step.vertex)],
        color: withAlpha(GREEN, alpha),
        radius: DOT_RADIUS,
      },
      {
        id: "split-pin",
        points: [pin],
        color: withAlpha(mixColor(RED, GREEN, arrived), alpha),
        radius: DOT_RADIUS,
      },
    ];
  };
  /** The gap between where the GPU puts the split point and where it belongs. */
  const gapLine = (
    k: number,
    alpha: number,
    pin: [number, number],
  ): LineDraw[] => {
    const step = record.steps[k];
    if (!step || alpha <= 0) {
      return [];
    }
    return [
      {
        id: "split-gap",
        paths: [[pin, vertexTarget(step.vertex)]],
        color: withAlpha(RED, alpha),
        width: 2,
        dashed: false,
        under: false,
      },
    ];
  };
  /** Whether proj4 returned a step's new vertex in another world copy. */
  const wasWrapped = (k: number): boolean => {
    const step = record.steps[k]!;
    const x = record.positions[2 * step.vertex]!;
    return Math.abs(step.split.rawX - x) > WORLD_WIDTH / 2;
  };

  /** Test points on the slide: source dot, GPU guess, exact spot, gap. */
  type SampleSlide = {
    source: [number, number][];
    guess: [number, number][];
    exact: [number, number][];
    gaps: [number, number][][];
  };
  const toSlide = (samples: ErrorSample[]): SampleSlide => {
    const guess = samples.map((s) => layout.targetToSlide(...s.guess));
    const exact = samples.map((s) => layout.targetToSlide(...s.exact));
    return {
      source: samples.map((s) => layout.uvToSource(...s.uv)),
      guess,
      exact,
      gaps: guess.map((g, i) => [g, exact[i]!]),
    };
  };
  const splitSampleCache = new Map<number, SampleSlide>();
  const splitSamples = (k: number): SampleSlide => {
    let cached = splitSampleCache.get(k);
    if (!cached) {
      cached = toSlide(record.steps[k]!.split.samples);
      splitSampleCache.set(k, cached);
    }
    return cached;
  };
  /** Small dots for test points: white in the source, red guess, green exact. */
  const sampleDots = (
    points: SampleSlide,
    pointsAlpha: number,
    exactAlpha: number,
  ): DotDraw[] => [
    ...(pointsAlpha > 0
      ? [
          {
            id: "samples-source",
            points: points.source,
            color: withAlpha(SAMPLE, pointsAlpha),
            radius: SAMPLE_RADIUS,
          },
          {
            id: "samples-guess",
            points: points.guess,
            color: withAlpha(RED, pointsAlpha),
            radius: SAMPLE_RADIUS,
          },
        ]
      : []),
    ...(exactAlpha > 0
      ? [
          {
            id: "samples-exact",
            points: points.exact,
            color: withAlpha(GREEN, exactAlpha),
            radius: SAMPLE_RADIUS,
          },
        ]
      : []),
  ];
  const sampleGaps = (points: SampleSlide, alpha: number): LineDraw[] =>
    alpha > 0
      ? [
          {
            id: "samples-gap",
            paths: points.gaps,
            color: withAlpha(RED, alpha),
            width: 1.5,
            dashed: false,
            under: false,
          },
        ]
      : [];

  const finalCounter = counterText(triangleCount(finalK), maxErrorAt(finalK));
  const wrappedCounter = counterText(2, scene.wrappedSeedMaxError);
  const seedCounter = counterText(2, record.seedMaxError);
  const defaultCount = scene.defaultTriangleCount.toLocaleString("en-US");
  const caption = `At the library's default tolerance (${LIBRARY_DEFAULT_MAX_ERROR} px), this image gets ${defaultCount} triangles.`;
  const seedSource = soup("source", 0);

  // 1. Start
  const start: StoryStep = {
    id: "start",
    title: "The input image",
    description: [
      "This 840 km square of the Bering Sea is stored in UTM zone 60N, where the 180° meridian is just a line through the middle of the image, nothing special. In Web Mercator, 180° is the edge of the world: x runs from −20,037 km at −180° to +20,037 km at +180°, then starts again. The image has to straddle that edge.",
    ],
    durationMs: 0,
    frame: () => ({
      meshes: [mesh("source", seedSource, withAlpha(SOURCE_EDGES, 0))],
      lines: worldLines(0),
      dots: [],
      hud: hud(null, null, worldLabels),
    }),
  };

  // 2. Cut
  const cut: StoryStep = {
    id: "cut",
    title: "Two triangles",
    description: [
      "As in the ",
      { text: "reprojection explainer", href: REPROJECTION_EXPLAINER },
      ", the mesh starts as two triangles that cover the image, split along a diagonal. They're refined later, but first their 4 corners need positions in Web Mercator.",
    ],
    durationMs: CUT_MS,
    frame: (t) => {
      const edgeAlpha = easeInOutCubic(progress(t, 100, CUT_MS - 200));
      return {
        meshes: [
          mesh("source", seedSource, withAlpha(SOURCE_EDGES, edgeAlpha)),
        ],
        lines: worldLines(0),
        dots: [],
        hud: hud(null, null, worldLabels),
      };
    },
  };

  // 3. Wrapped corners
  const seedFlight = makeFlight(
    0,
    FIRST_SPREAD_MS,
    scene.worldRawXY,
    scene.worldCopyXY,
  );
  const revealAt = seedFlight.durationMs + 100;
  const wrappedCorners: StoryStep = {
    id: "wrapped-corners",
    title: "Project the corners",
    description: [
      "proj4 returns every point in the same world, between −180° and +180°. The two corners west of 180° land near +20,037 km, where the image belongs (dashed). The two east of it come back near −20,037 km, on the far side of the map. So each triangle stretches across the whole world instead of 840 km. Refining can't fix this: wherever a new vertex lands, some triangle still spans the gap, so the error never goes down.",
    ],
    durationMs: revealAt + 600,
    frame: (t) => {
      const reveal = easeInOutCubic(progress(t, revealAt, 500));
      return {
        meshes: [
          mesh("source", seedSource, SOURCE_EDGES),
          mesh("flight", seedFlight.soupAt(t), TARGET_EDGES),
        ],
        lines: worldLines(reveal),
        dots: [],
        hud: hud(reveal > 0 ? wrappedCounter : null, null, worldLabels),
      };
    },
  };

  // 4. Unwrap the seed corners, then zoom in.
  const unwraps = record.seedUnwraps;
  const cornerStart = (c: number) => UNWRAP_START_MS + c * CORNER_MS;
  const moveAt = (c: number) =>
    cornerStart(c) +
    CORNER_PATH_MS +
    unwraps[c]!.samples.length * CORNER_SAMPLE_GAP_MS;
  const zoomAt = cornerStart(unwraps.length) + 200;
  const unwrapMs = zoomAt + ZOOM_MS + 300;
  const worldAt = (x: number, y: number) => worldLayout.targetToSlide(x, y);
  const unwrapStep: StoryStep = {
    id: "unwrap",
    title: "Snap to the nearest copy",
    description: [
      "The map repeats every world width W, so x and x ± W are the same place. With ",
      { text: "wrapX", emphasis: true },
      ", each vertex's x moves by whole worlds to the copy nearest a reference. The seed corners have no reference yet, so each is reached by walking from the corner before it: the path's midpoint snaps next to the start, then the corner snaps next to the midpoint. Hops longer than a quarter of a world are halved again, so even a 360°-wide image, whose edges proj4 returns at the same x, unwraps correctly.",
    ],
    durationMs: unwrapMs,
    frame: (t) => {
      const zoom = easeInOutCubic(progress(t, zoomAt, ZOOM_MS));
      // How far each corner has moved from where proj4 put it.
      const moved = (vertex: number): number => {
        const c = unwraps.findIndex((u) => u.vertex === vertex);
        return c < 0
          ? 1
          : easeInOutCubic(progress(t, moveAt(c), CORNER_MOVE_MS));
      };
      const place = (vertex: number): [number, number] => {
        const world = lerp2(
          at(scene.worldRawXY, vertex),
          at(scene.worldXY, vertex),
          moved(vertex),
        );
        return zoom > 0 ? lerp2(world, vertexTarget(vertex), zoom) : world;
      };

      const lines: LineDraw[] = [truthOutline(1, zoom), ...edges(zoom)];
      const dots: DotDraw[] = [];
      let caption: string | null = null;
      const c = unwraps.findIndex((_, i) => t < cornerStart(i + 1));
      const unwrap = unwraps[c];
      if (unwrap && t >= cornerStart(c)) {
        const t0 = cornerStart(c);
        const fade = 1 - progress(t, cornerStart(c + 1) - 300, 300);
        const pathAlpha =
          easeInOutCubic(progress(t, t0, CORNER_PATH_MS)) * fade;
        const fromXY = layout.uvToSource(
          record.uvs[2 * unwrap.from]!,
          record.uvs[2 * unwrap.from + 1]!,
        );
        const shown = unwrap.samples.filter(
          (_, j) => t >= t0 + CORNER_PATH_MS + j * CORNER_SAMPLE_GAP_MS,
        );
        lines.push({
          id: "unwrap-path",
          paths: [
            [
              fromXY,
              layout.uvToSource(
                ...unwrap.samples[unwrap.samples.length - 1]!.uv,
              ),
            ],
          ],
          color: withAlpha(PATH, pathAlpha),
          width: 3,
          dashed: false,
          under: false,
        });
        // Each sample: where proj4 put it (red), and the copy it snaps to
        // (green), next to the point before it on the path.
        const previousXY = [
          at(scene.worldXY, unwrap.from),
          ...shown.map((s) => worldAt(s.x, s.y)),
        ];
        lines.push({
          id: "unwrap-hops",
          paths: shown.map((s) => [worldAt(s.rawX, s.y), worldAt(s.x, s.y)]),
          color: withAlpha(RED, fade),
          width: 1.5,
          dashed: false,
          under: false,
        });
        dots.push(
          {
            id: "unwrap-source",
            points: [fromXY, ...shown.map((s) => layout.uvToSource(...s.uv))],
            color: withAlpha(SAMPLE, fade),
            radius: SAMPLE_RADIUS,
          },
          {
            id: "unwrap-raw",
            points: shown.map((s) => worldAt(s.rawX, s.y)),
            color: withAlpha(RED, fade),
            radius: SAMPLE_RADIUS,
          },
          {
            id: "unwrap-snapped",
            points: previousXY,
            color: withAlpha(GREEN, fade),
            radius: SAMPLE_RADIUS,
          },
        );
        caption = `The ${CORNER_NAMES[unwrap.vertex]} corner, walking from the ${CORNER_NAMES[unwrap.from]} one. Red: where proj4 puts each point. Green: the copy it snaps to.`;
      } else if (t >= zoomAt) {
        caption = "All 4 corners are in one world copy. Zoom in on the mesh.";
      }

      return {
        meshes: [
          mesh("source", seedSource, SOURCE_EDGES),
          mesh("target", seedWith(place), TARGET_EDGES),
        ],
        lines,
        dots,
        hud: hud(
          t >= unwrapMs - 300 ? seedCounter : wrappedCounter,
          caption,
          labelsAt(zoom),
        ),
      };
    },
  };

  // 5. Refine
  const timings = scheduleRefinement(finalK, settings.schedule);
  const refineMs = timings.length > 0 ? timings[timings.length - 1]!.end : 0;
  const refine: StoryStep = {
    id: "refine",
    title: "Refine the mesh",
    description: [
      "Now the mesh is refined as in the ",
      { text: "reprojection explainer", href: REPROJECTION_EXPLAINER },
      ": the triangle with the worst score (orange) gets a new vertex at its worst test point. That vertex needs a reference too, and it already has one: where the GPU draws the point, blended from the triangle's corners (red). That's off only by the reprojection error, a tiny fraction of a world, so the copy of the exact x nearest to it (green) is always the right one. Vertices east of 180° snap from the far side of the world to just past +180°. ",
      `We repeat until the largest error is below a threshold (here ${scene.finalMaxError} px). Drag the slider to stop on a split.`,
    ],
    durationMs: refineMs,
    scrubber:
      finalK > 0
        ? {
            count: finalK + 1,
            label: (position) => `${position} / ${finalK} splits`,
            // Pause in each split's highlight, once its tint and dots are in.
            timeAt: (position) => {
              const timing = timings[position];
              return timing
                ? lerp(timing.start, timing.highlightEnd, 0.8)
                : refineMs;
            },
            // A split counts as done once its new triangles are drawn, at
            // the end of its highlight.
            positionAt: (timeMs) => {
              if (timeMs >= refineMs) {
                return finalK;
              }
              const k = stepAt(timings, timeMs);
              return timeMs < timings[k]!.highlightEnd ? k : k + 1;
            },
          }
        : undefined,
    frame: (t, options) => {
      if (finalK === 0 || t >= refineMs) {
        return {
          meshes: [
            mesh("source", soup("source", finalK), SOURCE_EDGES),
            mesh("target", soup("target", finalK), TARGET_EDGES),
          ],
          lines: localLines,
          dots: [],
          hud: hud(finalCounter),
        };
      }
      const k = stepAt(timings, t);
      const timing = timings[k]!;
      const step = record.steps[k]!;
      const dotAlpha = options?.paused
        ? 1
        : clamp01((timing.end - timing.start - DOTS_MIN_STEP_MS) / 250);
      const guess = guessAt(k);
      const exact = vertexTarget(step.vertex);
      const stepCaption = wasWrapped(k) ? WRAPPED_CAPTION : HEAT_CAPTION;

      // Highlight the triangle with the largest error, before the split.
      if (t < timing.highlightEnd) {
        const fadeIn = easeInOutCubic(
          progress(t, timing.start, (timing.highlightEnd - timing.start) * 0.6),
        );
        const tint = (triangle: number): UnitColor =>
          triangle === step.split.index
            ? mixUnit(heat(k, triangle), HIGHLIGHT, fadeIn)
            : heat(k, triangle);
        return {
          meshes: [
            mesh("source", tinted(soup("source", k), k, tint), SOURCE_EDGES),
            mesh("target", tinted(soup("target", k), k, tint), TARGET_EDGES),
          ],
          lines: [
            ...localLines,
            ...sampleGaps(splitSamples(k), dotAlpha),
            ...gapLine(k, dotAlpha, guess),
          ],
          dots: [
            ...sampleDots(splitSamples(k), dotAlpha, dotAlpha),
            ...splitDots(k, dotAlpha, guess, 0),
          ],
          hud: hud(
            counterText(triangleCount(k), step.split.error),
            stepCaption,
          ),
        };
      }

      // Cut, then move the new corner from the GPU's guess to its exact spot.
      const after = k + 1;
      const fresh = trianglesUsing(after, step.vertex);
      if (t < timing.snapEnd) {
        const arrived =
          t < timing.cutEnd
            ? 0
            : easeInOutCubic(
                progress(t, timing.cutEnd, timing.snapEnd - timing.cutEnd),
              );
        const pin = lerp2(guess, exact, arrived);
        const tint = (triangle: number): UnitColor =>
          fresh.has(triangle) ? FRESH : heat(after, triangle);
        return {
          meshes: [
            mesh(
              "source",
              tinted(soup("source", after), after, tint),
              SOURCE_EDGES,
            ),
            mesh(
              "target",
              tinted(targetWithVertex(after, step.vertex, pin), after, tint),
              TARGET_EDGES,
            ),
          ],
          lines: [...localLines, ...gapLine(k, dotAlpha, pin)],
          dots: splitDots(k, dotAlpha, pin, arrived),
          hud: hud(
            counterText(triangleCount(after), step.split.error),
            stepCaption,
          ),
        };
      }

      // Hold: the new triangles are measured and take on their score's shade.
      const fade = 1 - progress(t, timing.snapEnd, timing.end - timing.snapEnd);
      const tint = (triangle: number): UnitColor =>
        fresh.has(triangle)
          ? mixUnit(heat(after, triangle), FRESH, fade)
          : heat(after, triangle);
      const settledDot: DotDraw[] =
        dotAlpha * fade > 0
          ? [
              {
                id: "split-exact",
                points: [exact],
                color: withAlpha(GREEN, dotAlpha * fade),
                radius: DOT_RADIUS,
              },
            ]
          : [];
      return {
        meshes: [
          mesh(
            "source",
            tinted(soup("source", after), after, tint),
            SOURCE_EDGES,
          ),
          mesh(
            "target",
            tinted(soup("target", after), after, tint),
            TARGET_EDGES,
          ),
        ],
        lines: localLines,
        dots: settledDot,
        hud: hud(counterText(triangleCount(after), step.maxError), stepCaption),
      };
    },
  };

  // 6. Fly over
  const finalFlight = makeFlight(
    finalK,
    FINAL_SPREAD_MS,
    scene.targetXY,
    scene.copyXY,
  );
  const flyOver: StoryStep = {
    id: "fly-over",
    title: "Map each triangle",
    description: [
      "Each triangle maps one piece of the image from UTM to Web Mercator, and the GPU stretches the image linearly inside it. The triangles that cross 180° are drawn whole, with no gap or seam along the meridian.",
    ],
    durationMs: CLEAR_MS + finalFlight.durationMs,
    frame: (t) => {
      const clear = easeInOutCubic(progress(t, 0, CLEAR_MS));
      const meshes = [mesh("source", soup("source", finalK), SOURCE_EDGES)];
      if (clear < 1) {
        meshes.push(
          mesh("target", soup("target", finalK), TARGET_EDGES, 1 - clear),
        );
      }
      if (t >= CLEAR_MS) {
        meshes.push(
          mesh("flight", finalFlight.soupAt(t - CLEAR_MS), TARGET_EDGES),
        );
      }
      return {
        meshes,
        lines: [slots(clear), ...localLines],
        dots: [],
        hud: hud(finalCounter),
      };
    },
  };

  // 7. Result
  const result: StoryStep = {
    id: "result",
    title: "Done",
    description: [
      "The mesh is in one piece, but its x now runs past +180°, into the next world copy. That's what the layer wants: deck.gl-raster cuts the mesh at 180° and moves the part east of it back by one world, so each part sits inside a single world copy and the two meet at the seam. All of this is in ",
      { text: "pull request #673", href: PULL_REQUEST },
      `. ${caption}`,
    ],
    durationMs: RESULT_MS,
    frame: (t) => {
      const fade = easeInOutCubic(progress(t, 0, RESULT_MS - 200));
      return {
        meshes: [
          mesh("source", soup("source", finalK), SOURCE_EDGES),
          mesh(
            "target",
            soup("target", finalK),
            withAlpha(TARGET_EDGES, 1 - fade),
          ),
        ],
        lines: [slots(1 - fade), ...localLines],
        dots: [],
        hud: hud(finalCounter, fade > 0 ? caption : null),
      };
    },
  };

  return [start, cut, wrappedCorners, unwrapStep, refine, flyOver, result];
}

/** "N triangles · max error X px (≈ Y km)". */
export function counterText(triangles: number, errorPx: number): string {
  const px = formatPx(errorPx);
  const km = errorPx * UTM_PIXEL_KM;
  const distance =
    km < 1 ? "< 1 km" : `≈ ${Math.round(km).toLocaleString("en-US")} km`;
  return `${triangles.toLocaleString("en-US")} triangles · max error ${px} px (${distance})`;
}

/** Whole pixels from 10 px up, two significant digits below. */
function formatPx(errorPx: number): string {
  if (errorPx >= 10) {
    return Math.round(errorPx).toString();
  }
  return errorPx >= 1 ? errorPx.toFixed(1) : errorPx.toFixed(2);
}

/** Each edge of a triangle mesh once, as a pair of vertex ids. */
export function uniqueEdges(triangles: ArrayLike<number>): [number, number][] {
  const seen = new Set<number>();
  const edges: [number, number][] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[t + k]!;
      const b = triangles[t + ((k + 1) % 3)]!;
      const key = Math.min(a, b) * 1_000_000 + Math.max(a, b);
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([a, b]);
      }
    }
  }
  return edges;
}

/** `color` with its alpha multiplied by `alpha` (clamped to 0–1). */
function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], color[3] * clamp01(alpha)];
}

/** `color` with its alpha multiplied by `alpha`. */
function scaleAlpha(color: UnitColor, alpha: number): UnitColor {
  return [color[0], color[1], color[2], color[3] * clamp01(alpha)];
}

/** Linear blend between two points. */
function lerp2(
  a: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

/** Linear blend between two polylines with the same number of points. */
function lerpLine(a: Polyline, b: Polyline, t: number): Polyline {
  return a.map((point, i) => lerp2(point, b[i]!, t));
}

/** Linear blend between two tints. */
function mixUnit(a: UnitColor, b: UnitColor, t: number): UnitColor {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
    lerp(a[3], b[3], t),
  ];
}

/** Linear blend between two colours. */
function mixColor(a: Rgba, b: Rgba, t: number): Rgba {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
    lerp(a[3], b[3], t),
  ];
}
