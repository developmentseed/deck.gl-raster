import type { TriangleSoup } from "../layers/triangle-soup.js";
import type { Scene } from "../scene/build-scene.js";
import { LIBRARY_DEFAULT_MAX_ERROR } from "../scene/build-scene.js";
import { NLCD_PIXEL_KM } from "../scene/nlcd.js";
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
const HIGHLIGHT: UnitColor = [1, 0.62, 0.04, 0.35];
/** Tint of the triangles a split just made. */
const FRESH: UnitColor = [1, 0.62, 0.04, 0.2];
const DOT_RADIUS = 7;

const CUT_MS = 900;
const FIRST_SPREAD_MS = 250;
const FINAL_SPREAD_MS = 1200;
const CLEAR_MS = 500;
const SNAP_DELAY_MS = 300;
const SNAP_MS = 1200;
const RESULT_MS = 1200;
/** Refinement steps shorter than this hide their dots, to avoid flicker. */
const DOTS_MIN_STEP_MS = 150;

/**
 * The six steps of the explainer, each a pure function from time to a
 * {@link Frame}:
 *
 * 1. `start`: the source image, and the true 49°N on an empty target panel.
 * 2. `cut`: the 2-triangle seed's edges appear.
 * 3. `first-attempt`: the 2 triangles fly over; the border misses the line.
 * 4. `refine`: replay of `refine()`, on both panels in sync.
 * 5. `fly-over`: every final triangle flies into its slot.
 * 6. `result`: the edges fade, leaving the reprojected image.
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
    description: [
      `We project the corners of each triangle to Web Mercator, then stretch the image linearly within each triangle. There's a lot of distortion, because we've only projected the corners: at the center of the image, it's ${seedErrorPx} input pixels, or about ${seedErrorKm} km.`,
    ],
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
          reveal > 0
            ? counterText(triangleCount(0), record.seedMaxError)
            : null,
        ),
      };
    },
  };

  // 4. Refine
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
        const tint = (triangle: number): UnitColor | null =>
          triangle === step.split.index ? scaleAlpha(HIGHLIGHT, fadeIn) : null;
        return {
          meshes: [
            mesh("source", tinted(soup("source", k), k, tint), SOURCE_EDGES),
            mesh("target", tinted(soup("target", k), k, tint), TARGET_EDGES),
          ],
          lines: [...truthLines, ...gapLine(k, dotAlpha, guess)],
          dots: splitDots(k, dotAlpha, guess, 0),
          hud: hud(counterText(triangleCount(k), step.split.error)),
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
        const tint = (triangle: number): UnitColor | null =>
          fresh.has(triangle) ? FRESH : null;
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
          hud: hud(counterText(triangleCount(after), step.split.error)),
        };
      }

      // Hold: the new triangles settle and their tint fades.
      const fade = 1 - progress(t, timing.snapEnd, timing.end - timing.snapEnd);
      const tint = (triangle: number): UnitColor | null =>
        fresh.has(triangle) ? scaleAlpha(FRESH, fade) : null;
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
        hud: hud(counterText(triangleCount(after), step.maxError)),
      };
    },
  };

  // 5. Fly over
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

  // 6. Result
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

  return [start, cut, firstAttempt, refine, flyOver, result];
}

/** "N triangles · max error X px (≈ Y km)". */
export function counterText(triangles: number, errorPx: number): string {
  const px =
    errorPx >= 10 ? Math.round(errorPx).toString() : errorPx.toFixed(1);
  const km = errorPx * NLCD_PIXEL_KM;
  const distance =
    km < 1 ? "< 1 km" : `≈ ${Math.round(km).toLocaleString("en-US")} km`;
  return `${triangles.toLocaleString("en-US")} triangles · max error ${px} px (${distance})`;
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

/** Linear blend between two colours. */
function mixColor(a: Rgba, b: Rgba, t: number): Rgba {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
    lerp(a[3], b[3], t),
  ];
}
