import type { TriangleSoup } from "../layers/triangle-soup.js";
import type { Scene } from "../scene/build-scene.js";
import { LIBRARY_DEFAULT_MAX_ERROR } from "../scene/build-scene.js";
import { NLCD_PIXEL_KM } from "../scene/nlcd.js";
import type { ErrorSample } from "../scene/refinement.js";
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
  /** How triangles travel in the "first attempt" and "fly over" steps. */
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
  | "first-attempt"
  | "measure"
  | "refine"
  | "flip"
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
  /** Text for a slider position, e.g. "37 / 108 splits". */
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

/** Colour of the 49th parallel baked into the texture. */
export const PARALLEL_COLOR = "#ff5a5a";

const SOURCE_EDGES: Rgba = [255, 255, 255, 200];
const TARGET_EDGES: Rgba = [255, 255, 255, 150];
const EDGE_WIDTH = 0.75;
const RED: Rgba = [255, 69, 58, 255];
const GREEN: Rgba = [48, 209, 88, 255];
const TRUTH: Rgba = [255, 255, 255, 230];
const OUTLINE: Rgba = [255, 255, 255, 110];
const SLOTS: Rgba = [255, 255, 255, 70];
/** Tint of the triangle about to be split. */
const HIGHLIGHT: UnitColor = [1, 0.62, 0.04, 0.55];
/** Tint of a triangle with the worst score; others are fainter. */
const HEAT: UnitColor = [1, 0.27, 0.23, 0.3];
/** Tint of the two triangles an edge flip made. */
const FLIPPED: UnitColor = [0.19, 0.82, 0.35, 0.45];
/** Tint of the triangles a split just made. */
const FRESH: UnitColor = [1, 0.62, 0.04, 0.2];
const DOT_RADIUS = 7;
const HEAT_CAPTION =
  "Shading shows each triangle's score. The worst (orange) is split next.";
const SAMPLE: Rgba = [255, 255, 255, 255];
const SAMPLE_RADIUS = 4;

const CUT_MS = 900;
const FIRST_SPREAD_MS = 250;
const FINAL_SPREAD_MS = 1200;
const CLEAR_MS = 500;
const SNAP_DELAY_MS = 300;
const SNAP_MS = 1200;
const RESULT_MS = 1200;
const MEASURE_POINTS_MS = 600;
const MEASURE_GAPS_AT = 900;
const MEASURE_WORST_AT = 2100;
const MEASURE_MS = 3000;
const FLIP_SWING_AT = 1200;
const FLIP_SWING_MS = 900;
const FLIP_MS = 3400;
/** Refinement steps shorter than this hide their dots, to avoid flicker. */
const DOTS_MIN_STEP_MS = 150;

/**
 * The eight steps of the explainer, each a pure function from time to a
 * {@link Frame}:
 *
 * 1. `start`: the source image, and the true 49°N on an empty target panel.
 * 2. `cut`: the 2-triangle seed's edges appear.
 * 3. `first-attempt`: the 2 triangles fly over; the border misses the line.
 * 4. `measure`: the 4 test points of each seed triangle and their errors.
 * 5. `refine`: replay of `refine()`, on both panels in sync.
 * 6. `flip`: one edge flip from the refinement, undone and redone.
 * 7. `fly-over`: every final triangle flies into its slot.
 * 8. `result`: the edges fade, leaving the reprojected image.
 */
export function createStory(
  scene: Scene,
  settings: StorySettings,
): StoryStep[] {
  const { layout, record } = scene;
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

  const vertexTarget = (vertex: number): [number, number] => [
    scene.targetXY[2 * vertex]!,
    scene.targetXY[2 * vertex + 1]!,
  ];
  const guessAt = (k: number): [number, number] => [
    scene.guessXY[2 * k]!,
    scene.guessXY[2 * k + 1]!,
  ];

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

  const makeFlight = (k: number, spreadMs: number) => {
    const triangles = trianglesAt(k);
    const paths: FlightPaths = {
      source: expandByCorner(triangles, scene.sourceXY, 2),
      copy: expandByCorner(triangles, scene.copyXY, 2),
      target: expandByCorner(triangles, scene.targetXY, 2),
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

  /** The image's true outline on the target panel, hidden before step 3. */
  const outlinePaths = [scene.outlineTarget];
  const truthOutline = (alpha: number): LineDraw => ({
    id: "truth-outline",
    paths: outlinePaths,
    color: withAlpha(OUTLINE, alpha),
    width: 1.5,
    dashed: true,
    under: false,
  });
  const truthParallel: LineDraw = {
    id: "truth-parallel",
    paths: [scene.parallelTarget],
    color: TRUTH,
    width: 2,
    dashed: true,
    under: false,
  };
  const truthLines: LineDraw[] = [truthOutline(1), truthParallel];
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

  const sourceMid =
    scene.parallelSource[Math.floor(scene.parallelSource.length / 2)]!;
  const targetEnd = scene.parallelTarget[scene.parallelTarget.length - 1]!;
  const labels: Label[] = [
    {
      id: "parallel-source",
      text: "49°N",
      x: sourceMid[0],
      y: sourceMid[1] - 30,
      align: "center",
      color: PARALLEL_COLOR,
      opacity: 1,
    },
    {
      id: "parallel-target",
      text: "49°N",
      x: targetEnd[0] + 12,
      y: targetEnd[1],
      align: "left",
      color: "#ffffff",
      opacity: 1,
    },
  ];
  const hud = (counter: string | null, caption: string | null = null): Hud => ({
    counter,
    caption,
    labels,
  });

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
  const seedErrorPx = Math.round(record.seedMaxError);
  const seedErrorKm =
    Math.round((record.seedMaxError * NLCD_PIXEL_KM) / 10) * 10;
  const defaultCount = scene.defaultTriangleCount.toLocaleString("en-US");
  const caption = `At the library's default tolerance (${LIBRARY_DEFAULT_MAX_ERROR} px), this image would get ${defaultCount} triangles.`;

  // 1. Start
  const start: StoryStep = {
    id: "start",
    title: "The input image",
    description: [
      "This is the image we want to render. It's stored in an Albers equal-area projection, but we want to display it in Web Mercator. Note the 49th parallel: in Albers equal-area it's curved, while in Web Mercator it's a straight line.",
    ],
    durationMs: 0,
    frame: () => ({
      meshes: [mesh("source", soup("source", 0), withAlpha(SOURCE_EDGES, 0))],
      lines: [truthParallel],
      dots: [],
      hud: hud(null),
    }),
  };

  // 2. Cut
  const cut: StoryStep = {
    id: "cut",
    title: "Two triangles",
    description: [
      "GPUs only render ",
      { text: "triangles", emphasis: true },
      ", so we need a set of triangles that covers the input image. The simplest place to start is a diagonal, which gives two triangles that together cover the full image. In the input coordinate system, these triangles have no distortion.",
    ],
    durationMs: CUT_MS,
    frame: (t) => {
      const edges = easeInOutCubic(progress(t, 100, CUT_MS - 200));
      return {
        meshes: [
          mesh("source", soup("source", 0), withAlpha(SOURCE_EDGES, edges)),
        ],
        lines: [truthParallel],
        dots: [],
        hud: hud(null),
      };
    },
  };

  // 3. First attempt
  const seedFlight = makeFlight(0, FIRST_SPREAD_MS);
  const revealAt = seedFlight.durationMs + 100;
  const firstAttempt: StoryStep = {
    id: "first-attempt",
    title: "Project the corners",
    description: [
      "We project the corners of each triangle to Web Mercator, then stretch the image linearly within each triangle. The corners land exactly where they belong, but the edges between them stay straight, while the image's true outline (dashed) is curved. Everything between the corners is off: the red 49th parallel in the image sags well below the true line.",
    ],
    durationMs: revealAt + 600,
    frame: (t) => {
      const reveal = easeInOutCubic(progress(t, revealAt, 500));
      return {
        meshes: [
          mesh("source", soup("source", 0), SOURCE_EDGES),
          mesh("flight", seedFlight.soupAt(t), TARGET_EDGES),
        ],
        lines: [truthOutline(reveal), truthParallel],
        dots: [],
        hud: hud(null),
      };
    },
  };

  // 4. Measure
  // The seed triangles share their diagonal, so drop its repeated midpoint.
  const seedSamples = [
    ...new Map(
      record.seedSamples.flat().map((s) => [s.uv.join(","), s]),
    ).values(),
  ];
  const seedSlide = toSlide(seedSamples);
  const worstSample = seedSamples.reduce((a, b) => (b.error > a.error ? b : a));
  const measure: StoryStep = {
    id: "measure",
    title: "Measure the error",
    description: [
      "How wrong is the straight-line stretch? Each triangle is tested at ",
      { text: "4 points", emphasis: true },
      ": its centroid and the midpoint of each edge. The red dot is where the GPU draws a test point, blended linearly from the triangle's corners. The green dot is where that point really belongs. To score it, the red position is projected back into the input image, and its distance from the test point is the error, in input pixels. Each triangle is scored by its worst test point, and the triangles are ranked with the worst first. ",
      `Here the worst point is the middle of the image: ${seedErrorPx} input pixels, or about ${seedErrorKm} km.`,
    ],
    durationMs: MEASURE_MS,
    frame: (t) => {
      const points = easeInOutCubic(progress(t, 0, MEASURE_POINTS_MS));
      const gaps = easeInOutCubic(progress(t, MEASURE_GAPS_AT, 600));
      const worst = easeInOutCubic(progress(t, MEASURE_WORST_AT, 600));
      const tint = (): UnitColor => scaleAlpha(HIGHLIGHT, 0.35 * worst);
      const errorLabels: Label[] = seedSamples.map((sample, i) => {
        // Just past the green dot, continuing the line from the red one.
        const [gx, gy] = seedSlide.guess[i]!;
        const [ex, ey] = seedSlide.exact[i]!;
        const length = Math.hypot(ex - gx, ey - gy) || 1;
        const isWorst = sample === worstSample;
        return {
          id: `sample-error-${i}`,
          text: `${formatPx(sample.error)} px${isWorst && worst > 0 ? " · worst" : ""}`,
          x: ex + ((ex - gx) / length) * 26,
          y: ey + ((ey - gy) / length) * 26,
          align: "center",
          color: "#ffffff",
          opacity: gaps * (isWorst ? 1 : 1 - 0.3 * worst),
        };
      });
      return {
        meshes: [
          mesh("source", tinted(soup("source", 0), 0, tint), SOURCE_EDGES),
          mesh("target", tinted(soup("target", 0), 0, tint), TARGET_EDGES),
        ],
        lines: [...truthLines, ...sampleGaps(seedSlide, gaps)],
        dots: [
          ...sampleDots(seedSlide, points, gaps),
          ...splitDots(0, worst, guessAt(0), 0),
        ],
        hud: {
          ...hud(counterText(triangleCount(0), record.seedMaxError)),
          labels: [...labels, ...errorLabels],
          caption:
            worst > 0
              ? "The worst test point is where the first new vertex goes."
              : null,
        },
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
      "Every triangle has a score: the error at its worst test point. The stronger a triangle's red shading, the higher its score. We take the triangle with the highest score (orange) and add a vertex at its worst test point, at the point's exact position. If that point is the midpoint of an edge, both triangles that share the edge are split. Then edges are flipped where needed to avoid thin triangles (keeping the mesh a Delaunay triangulation). Only the new triangles are measured, at 4 test points each. Every other triangle keeps its score. ",
      `We repeat until the largest error is below a threshold (here ${scene.finalMaxError} px). Drag the slider to stop on a split and see its triangle's test points.`,
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
          lines: truthLines,
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
            ...truthLines,
            ...sampleGaps(splitSamples(k), dotAlpha),
            ...gapLine(k, dotAlpha, guess),
          ],
          dots: [
            ...sampleDots(splitSamples(k), dotAlpha, dotAlpha),
            ...splitDots(k, dotAlpha, guess, 0),
          ],
          hud: hud(
            counterText(triangleCount(k), step.split.error),
            HEAT_CAPTION,
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
        const pin: [number, number] = [
          lerp(guess[0], exact[0], arrived),
          lerp(guess[1], exact[1], arrived),
        ];
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
          lines: [...truthLines, ...gapLine(k, dotAlpha, pin)],
          dots: splitDots(k, dotAlpha, pin, arrived),
          hud: hud(
            counterText(triangleCount(after), step.split.error),
            HEAT_CAPTION,
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
        lines: truthLines,
        dots: settledDot,
        hud: hud(
          counterText(triangleCount(after), step.maxError),
          HEAT_CAPTION,
        ),
      };
    },
  };

  // 6. Flip
  const { flip } = scene;
  const flipAfter = flip ? flip.step + 1 : finalK;
  const flipBefore = flip
    ? {
        source: createSoup({
          triangles: flip.before,
          positions: scene.sourceXY,
          uvs: record.uvs,
        }),
        target: createSoup({
          triangles: flip.before,
          positions: scene.targetXY,
          uvs: record.uvs,
        }),
      }
    : null;
  const sourceAt = (vertex: number): [number, number] => [
    scene.sourceXY[2 * vertex]!,
    scene.sourceXY[2 * vertex + 1]!,
  ];
  const flipStep: StoryStep = {
    id: "flip",
    title: "Flip thin triangles",
    description: [
      "Joining a new vertex to the corners around it can leave long, thin triangles. Those are bad for us: their 4 test points bunch up along one line and can miss the error, and a long triangle needs more splits to get its error down. ",
      "But any two triangles that share an edge form a four-sided shape, and it can be cut along either diagonal. So after each split, we check each pair of neighbours and switch to the other diagonal whenever it makes fatter triangles. This is called a ",
      { text: "Delaunay triangulation", emphasis: true },
      ". ",
      flip
        ? `Here, split ${flip.step + 1} left two thin triangles (orange); flipping their shared edge makes two fatter ones (green). Flipped triangles are measured again, just like the new ones.`
        : "Flipped triangles are measured again, just like the new ones.",
    ],
    durationMs: flip ? FLIP_MS : 0,
    frame: (t) => {
      const counter = hud(
        counterText(triangleCount(flipAfter), maxErrorAt(flipAfter)),
        "Swap a shared edge when the other diagonal makes fatter triangles.",
      );
      if (!flip || !flipBefore) {
        return {
          meshes: [
            mesh("source", soup("source", finalK), SOURCE_EDGES),
            mesh("target", soup("target", finalK), TARGET_EDGES),
          ],
          lines: truthLines,
          dots: [],
          hud: counter,
        };
      }
      const show = easeInOutCubic(progress(t, 0, 500));
      const swing = easeInOutCubic(progress(t, FLIP_SWING_AT, FLIP_SWING_MS));
      const flipped = swing >= 0.5;
      const pair = new Set(flip.triangles);
      const tint = (triangle: number): UnitColor | null =>
        pair.has(triangle)
          ? flipped
            ? FLIPPED
            : scaleAlpha(HIGHLIGHT, show)
          : null;
      const [u, w] = flip.from;
      const [p, x] = flip.to;
      const diagonal = (at: (vertex: number) => [number, number]) => [
        lerp2(at(u), at(p), swing),
        lerp2(at(w), at(x), swing),
      ];
      const source = flipped ? soup("source", flipAfter) : flipBefore.source;
      const target = flipped ? soup("target", flipAfter) : flipBefore.target;
      return {
        meshes: [
          mesh("source", tinted(source, flipAfter, tint), SOURCE_EDGES),
          mesh("target", tinted(target, flipAfter, tint), TARGET_EDGES),
        ],
        lines: [
          ...truthLines,
          {
            id: "flip-diagonal",
            paths: [diagonal(sourceAt), diagonal(vertexTarget)],
            color: withAlpha(mixColor(RED, GREEN, swing), show),
            width: 3,
            dashed: false,
            under: false,
          },
        ],
        dots: [],
        hud: counter,
      };
    },
  };

  // 7. Fly over
  const finalFlight = makeFlight(finalK, FINAL_SPREAD_MS);
  const flyOver: StoryStep = {
    id: "fly-over",
    title: "Map each triangle",
    description: [
      "Each triangle maps one piece of the image from the input coordinate system to the output coordinate system. Inside each triangle, the GPU stretches the image linearly.",
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
        lines: [slots(clear), ...truthLines],
        dots: [],
        hud: hud(finalCounter),
      };
    },
  };

  // 8. Result
  const result: StoryStep = {
    id: "result",
    title: "Done",
    description: [
      "That's it! The image is now projected into our target coordinate system. Finding the set of triangles, called mesh generation, is efficient and fast on the CPU. Then the hard work of resampling pixels happens on the GPU. This approach is derived from ",
      { text: "delatin", href: "https://github.com/mapbox/delatin" },
      ", a terrain mesh generation library written by Volodymyr Agafonkin. See ",
      { text: "its demo", href: "https://mapbox.github.io/delatin/" },
      ` for how this process works for terrain. ${caption}`,
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
        lines: [slots(1 - fade), ...truthLines],
        dots: [],
        hud: hud(finalCounter, fade > 0 ? caption : null),
      };
    },
  };

  return [start, cut, firstAttempt, measure, refine, flipStep, flyOver, result];
}

/** "N triangles · max error X px (≈ Y km)". */
export function counterText(triangles: number, errorPx: number): string {
  const px = formatPx(errorPx);
  const km = errorPx * NLCD_PIXEL_KM;
  const distance =
    km < 1 ? "< 1 km" : `≈ ${Math.round(km).toLocaleString("en-US")} km`;
  return `${triangles.toLocaleString("en-US")} triangles · max error ${px} px (${distance})`;
}

/** Whole pixels from 10 px up, one decimal below. */
function formatPx(errorPx: number): string {
  return errorPx >= 10 ? Math.round(errorPx).toString() : errorPx.toFixed(1);
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
