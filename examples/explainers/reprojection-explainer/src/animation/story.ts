import type { TriangleSoup } from "../layers/triangle-soup.js";
import type { Scene } from "../scene/build-scene.js";
import { LIBRARY_DEFAULT_MAX_ERROR } from "../scene/build-scene.js";
import type { Rect } from "../scene/layout.js";
import { SOURCE_BOX, TARGET_BOX } from "../scene/layout.js";
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

/** Colour of the reference parallel baked into the texture. */
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
const HIGHLIGHT: UnitColor = [1, 0.62, 0.04, 0.35];
/**
 * Tint of a triangle with the seed's error. Smaller errors are fainter, and
 * the tint is gone at the final tolerance.
 */
const HEAT: UnitColor = [1, 0.27, 0.23, 0.3];
/** Tint of the triangles a split just made. */
const FRESH: UnitColor = [1, 0.62, 0.04, 0.2];
const DOT_RADIUS = 7;
const SAMPLE: Rgba = [255, 255, 255, 255];
const SAMPLE_RADIUS = 4;
/** Font sizes of the error labels: the worst one, and the rest. */
const WORST_LABEL_SIZE = 22;
const SAMPLE_LABEL_SIZE = 16;
/**
 * Where error labels may go: each panel's box, widened into the gap between
 * the panels, and stretched up to the panel titles and down to the counter.
 */
const SOURCE_LABEL_AREA = labelArea(SOURCE_BOX);
const TARGET_LABEL_AREA = labelArea(TARGET_BOX);

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
/** Refinement steps shorter than this hide their dots, to avoid flicker. */
const DOTS_MIN_STEP_MS = 150;

/**
 * The seven steps of the explainer, each a pure function from time to a
 * {@link Frame}:
 *
 * 1. `start`: the source image, and the true reference parallel on an empty
 *    target panel.
 * 2. `cut`: the 2-triangle seed's edges appear.
 * 3. `first-attempt`: the 2 triangles fly over; the border misses the line.
 * 4. `measure`: the test points of the seed triangles and their errors.
 * 5. `refine`: replay of `refine()`, on both panels in sync.
 * 6. `fly-over`: every final triangle flies into its slot.
 * 7. `result`: the edges fade, leaving the reprojected image.
 */
export function createStory(
  scene: Scene,
  settings: StorySettings,
): StoryStep[] {
  const { layout, record, scenario } = scene;
  // Each mode draws and labels the gap it measures: in the input image for
  // source pixels, on the map for pixels on the map.
  const inSource = scene.errorSpace === "source";
  const counter = (triangles: number, errorPx: number) =>
    counterText(triangles, errorPx, {
      kmPerPixel: scenario.kmPerPixel,
      unit: inSource ? "px" : "px on the map",
    });
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
  // Tint by error on a log scale, from full at the seed's error to clear at
  // the final tolerance, so the tint fades as the mesh converges. Squaring
  // it fades the tint sooner, once the largest errors are gone.
  const heatRange = Math.log(record.seedMaxError / scene.finalMaxError);
  const heat = (k: number, triangle: number): UnitColor => {
    const level =
      heatRange > 0
        ? clamp01(
            Math.log(scoresAt(k)[triangle]! / scene.finalMaxError) / heatRange,
          )
        : 0;
    return scaleAlpha(HEAT, level * level);
  };
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

  const truthLines: LineDraw[] = [
    {
      id: "truth-outline",
      paths: [scene.outlineTarget],
      color: OUTLINE,
      width: 1.5,
      dashed: true,
      under: false,
    },
    {
      id: "truth-parallel",
      paths: [scene.parallelTarget],
      color: TRUTH,
      width: 2,
      dashed: true,
      under: false,
    },
  ];
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
      text: scenario.parallel.label,
      x: sourceMid[0],
      y: sourceMid[1] - 30,
      align: "center",
      color: PARALLEL_COLOR,
      opacity: 1,
    },
    {
      id: "parallel-target",
      text: scenario.parallel.label,
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

  /**
   * Test points on the slide: the point in the image, the GPU's guess and the
   * exact spot on the map, and the guess mapped back into the image; with the
   * gap on the map (guess to exact) and in the image (point to mapped back).
   */
  type SampleSlide = {
    source: [number, number][];
    guess: [number, number][];
    exact: [number, number][];
    sampled: [number, number][];
    gaps: [number, number][][];
    sourceGaps: [number, number][][];
  };
  const toSlide = (samples: ErrorSample[]): SampleSlide => {
    const source = samples.map((s) => layout.uvToSource(...s.uv));
    const guess = samples.map((s) => layout.targetToSlide(...s.guess));
    const exact = samples.map((s) => layout.targetToSlide(...s.exact));
    const sampled = samples.map((s) => layout.uvToSource(...s.sampled));
    return {
      source,
      guess,
      exact,
      sampled,
      gaps: guess.map((g, i) => [g, exact[i]!]),
      sourceGaps: source.map((p, i) => [p, sampled[i]!]),
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
  /**
   * Small dots for test points: white in the image, red guess and green exact
   * spot on the map; in source mode, also the red guess mapped back into the
   * image, which arrives with the exact spot.
   */
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
          ...(inSource
            ? [
                {
                  id: "samples-sampled",
                  points: points.sampled,
                  color: withAlpha(RED, exactAlpha),
                  radius: SAMPLE_RADIUS,
                },
              ]
            : []),
        ]
      : []),
  ];
  /** The test points' gaps on the map, and in source mode in the image. */
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
          ...(inSource
            ? [
                {
                  id: "samples-source-gap",
                  paths: points.sourceGaps,
                  color: withAlpha(RED, alpha),
                  width: 1.5,
                  dashed: false,
                  under: false,
                },
              ]
            : []),
        ]
      : [];

  // The seed triangles share their diagonal, so drop its repeated midpoint.
  const seedSamples = [
    ...new Map(
      record.seedSamples.flat().map((s) => [s.uv.join(","), s]),
    ).values(),
  ];
  const worstSample = seedSamples.reduce((a, b) => (b.error > a.error ? b : a));

  const finalCounter = counter(triangleCount(finalK), maxErrorAt(finalK));
  const seedErrorPx = Math.round(record.seedMaxError);
  const seedErrorKm =
    Math.round((record.seedMaxError * scenario.kmPerPixel) / 10) * 10;
  const defaultCount = scene.defaultTriangleCount.toLocaleString("en-US");
  const caption = `At the library's default tolerance (${LIBRARY_DEFAULT_MAX_ERROR} px), this image would get ${defaultCount} triangles.`;

  // 1. Start
  const start: StoryStep = {
    id: "start",
    title: "The input image",
    description: scenario.introduction,
    durationMs: 0,
    frame: () => ({
      meshes: [mesh("source", soup("source", 0), withAlpha(SOURCE_EDGES, 0))],
      lines: truthLines,
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
        lines: truthLines,
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
    description: scenario.firstAttempt({
      where: seedPointPhrase(worstSample.uv),
      error: seedErrorPx,
      errorKm: seedErrorKm,
      pixels: inSource ? "input pixels" : "pixels on the map",
    }),
    durationMs: revealAt + 600,
    frame: (t) => {
      const reveal = easeInOutCubic(progress(t, revealAt, 500));
      const pin = guessAt(0);
      return {
        meshes: [
          mesh("source", soup("source", 0), SOURCE_EDGES),
          mesh("flight", seedFlight.soupAt(t), TARGET_EDGES),
        ],
        lines: [...truthLines, ...gapLine(0, reveal, pin)],
        dots: splitDots(0, reveal, pin, 0),
        hud: hud(
          reveal > 0 ? counter(triangleCount(0), record.seedMaxError) : null,
        ),
      };
    },
  };

  // 4. Measure
  const seedSlide = toSlide(seedSamples);
  const measure: StoryStep = {
    id: "measure",
    title: "Measure the error",
    description: [
      "To find where the distortion is highest, we test a few points in each triangle (currently its center and the middle of each edge, though this may change). At each point, we compare where the GPU draws it (red) with where it really belongs (green).",
    ],
    durationMs: MEASURE_MS,
    // Starts where the first attempt ends, with the center's error showing.
    frame: (t) => {
      const points = easeInOutCubic(progress(t, 0, MEASURE_POINTS_MS));
      const gaps = easeInOutCubic(progress(t, MEASURE_GAPS_AT, 600));
      const focus = easeInOutCubic(progress(t, MEASURE_WORST_AT, 600));
      // Once every error is in, the others step back from the worst.
      const others = 1 - 0.25 * focus;
      const pin = guessAt(0);
      const errorLabels: Label[] = seedSamples.map((sample, i) => {
        const isWorst = sample === worstSample;
        const size = isWorst ? WORST_LABEL_SIZE : SAMPLE_LABEL_SIZE;
        const text = `${formatPx(sample.error)} px${isWorst ? " · worst" : ""}`;
        return {
          id: `sample-error-${i}`,
          text,
          // Past the true end of the gap being measured: the test point in
          // the image, or its exact spot on the map.
          ...labelBeyond(
            inSource ? seedSlide.sampled[i]! : seedSlide.guess[i]!,
            inSource ? seedSlide.source[i]! : seedSlide.exact[i]!,
            {
              clearance: isWorst ? 18 : 14,
              size,
              text,
              area: inSource ? SOURCE_LABEL_AREA : TARGET_LABEL_AREA,
            },
          ),
          color: "#ffffff",
          opacity: gaps * (isWorst ? 1 : others),
          size,
        };
      });
      return {
        meshes: [
          mesh("source", soup("source", 0), SOURCE_EDGES),
          mesh("target", soup("target", 0), TARGET_EDGES),
        ],
        lines: [
          ...truthLines,
          ...sampleGaps(seedSlide, gaps * others),
          ...gapLine(0, 1, pin),
        ],
        dots: [
          ...sampleDots(seedSlide, points * others, gaps * others),
          ...splitDots(0, 1, pin, 0),
        ],
        hud: {
          ...hud(counter(triangleCount(0), record.seedMaxError)),
          labels: [...labels, ...errorLabels],
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
      `We add a new vertex where the distortion is highest and rebuild the triangles around it. Then we find the next place of highest distortion and add a vertex there, too. We continue until the maximum error is below a threshold (here ${scene.finalMaxError} px).`,
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
          hud: hud(counter(triangleCount(k), step.split.error)),
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
          hud: hud(counter(triangleCount(after), step.split.error)),
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
        hud: hud(counter(triangleCount(after), step.maxError)),
      };
    },
  };

  // 6. Fly over
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

  // 7. Result
  const result: StoryStep = {
    id: "result",
    title: "Done",
    description: [
      "That's it! The image is now projected into our target coordinate system. Finding the set of triangles, called mesh generation, is efficient and fast on the CPU. Then the hard work of resampling pixels happens on the GPU. This approach is derived from ",
      { text: "delatin", href: "https://github.com/mapbox/delatin" },
      ", a terrain mesh generation library written by ",
      { text: "Volodymyr Agafonkin", href: "https://agafonkin.com/" },
      ". See ",
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

  return [start, cut, firstAttempt, measure, refine, flyOver, result];
}

/** Options for {@link counterText}. */
export type CounterTextOptions = {
  /** Ground size of one pixel, in km. */
  kmPerPixel: number;
  /** Unit of the error, e.g. "px on the map". Defaults to "px". */
  unit?: string;
};

/** "N triangles · max error X px (≈ Y km)". */
export function counterText(
  triangles: number,
  errorPx: number,
  options: CounterTextOptions,
): string {
  const px = formatPx(errorPx);
  const unit = options.unit ?? "px";
  const km = errorPx * options.kmPerPixel;
  const distance =
    km < 1 ? "< 1 km" : `≈ ${Math.round(km).toLocaleString("en-US")} km`;
  return `${triangles.toLocaleString("en-US")} triangles · max error ${px} ${unit} (${distance})`;
}

/**
 * Where a test point of the 2-triangle seed sits in the image, for step 3:
 * "at the center of the image", "at the middle of the image's top edge", and
 * so on. `uv` is one of the seed's test points (0–1, v down).
 */
export function seedPointPhrase([u, v]: [number, number]): string {
  if (u === 0.5 && v === 0.5) {
    return "at the center of the image";
  }
  const edge =
    v === 0
      ? "top"
      : v === 1
        ? "bottom"
        : u === 0
          ? "left"
          : u === 1
            ? "right"
            : null;
  return edge
    ? `at the middle of the image's ${edge} edge`
    : "at the center of one of the triangles";
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

/** A label's anchor and alignment. */
type LabelPlacement = Pick<Label, "x" | "y" | "align">;

/** Options for {@link labelBeyond}. */
type LabelBeyondOptions = {
  /** Gap between the dot's centre and the label, in slide units. */
  clearance: number;
  /** Font size, in slide units. */
  size: number;
  /** The label's text, to estimate its width. */
  text: string;
  /** Where the label must stay. */
  area: Rect;
};

/**
 * Where to put a label for the dot at `to`, so it covers neither that dot nor
 * the line to it from `from`: just past `to`, continuing away from `from`.
 * Where that leaves `area`, beside the dot instead (clear of the line too),
 * and as a last resort before it.
 */
function labelBeyond(
  from: [number, number],
  to: [number, number],
  { clearance, size, text, area }: LabelBeyondOptions,
): LabelPlacement {
  const right: LabelPlacement = {
    x: to[0] + clearance,
    y: to[1],
    align: "left",
  };
  const left: LabelPlacement = {
    x: to[0] - clearance,
    y: to[1],
    align: "right",
  };
  // Labels are vertically centred on their anchor, so also clear half a line.
  const offset = clearance + size * 0.6;
  const below: LabelPlacement = {
    x: to[0],
    y: to[1] + offset,
    align: "center",
  };
  const above: LabelPlacement = {
    x: to[0],
    y: to[1] - offset,
    align: "center",
  };
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const candidates =
    Math.abs(dx) >= Math.abs(dy)
      ? dx >= 0
        ? [right, above, below, left]
        : [left, above, below, right]
      : dy >= 0
        ? [below, right, left, above]
        : [above, right, left, below];
  return (
    candidates.find((placement) =>
      labelFits(placement, { size, text, area }),
    ) ?? candidates[0]!
  );
}

/** Whether a label placed at `placement` stays inside `area`. */
function labelFits(
  { x, y, align }: LabelPlacement,
  { size, text, area }: Pick<LabelBeyondOptions, "size" | "text" | "area">,
): boolean {
  // A generous estimate of the rendered width: 0.6 em per character.
  const width = 0.6 * size * text.length;
  const left =
    align === "left" ? x : align === "right" ? x - width : x - width / 2;
  return (
    left >= area.x &&
    left + width <= area.x + area.width &&
    y - 0.6 * size >= area.y &&
    y + 0.6 * size <= area.y + area.height
  );
}

/**
 * The slide area error labels may cover in a panel: its box, widened by
 * half the gap between the panels, from just under the panel titles to just
 * above the counter and description.
 */
function labelArea(box: Rect): Rect {
  return {
    x: box.x - 60,
    y: box.y - 15,
    width: box.width + 120,
    height: box.height + 35,
  };
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
