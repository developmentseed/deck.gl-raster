import type { Layout } from "./layout.js";
import { createLayout, SOURCE_BOX, TARGET_BOX } from "./layout.js";
import type { Polyline } from "./lines.js";
import {
  imageOutlineInTarget,
  parallelPolyline,
  polylineBounds,
} from "./lines.js";
import type { RefinementRecord } from "./refinement.js";
import { countTriangles, recordRefinement } from "./refinement.js";
import type { Scenario } from "./scenario.js";

/** The library's default mesh tolerance, in source pixels. */
export const LIBRARY_DEFAULT_MAX_ERROR = 0.125;

/** Everything the animation needs, precomputed in slide units. */
export type Scene = {
  /** The image and projections being animated. */
  scenario: Scenario;
  /** Panel placement and coordinate mappings. */
  layout: Layout;
  /** The recorded refinement, from the 2-triangle seed to the final mesh. */
  record: RefinementRecord;
  /** Every vertex of the final mesh on the source panel, 2 per vertex. */
  sourceXY: Float32Array;
  /** Every vertex at its exact reprojected position on the target panel. */
  targetXY: Float32Array;
  /** Every vertex on the source-sized copy centred on the target panel. */
  copyXY: Float32Array;
  /**
   * Where the GPU drew each step's split point before the split (its linear
   * guess), on the target panel, 2 per step.
   */
  guessXY: Float32Array;
  /** The true reference parallel on the target panel. */
  parallelTarget: Polyline;
  /** The true outline of the image on the target panel. */
  outlineTarget: Polyline;
  /** The reference parallel on the source panel. */
  parallelSource: Polyline;
  /** Triangles the library builds for this image at its default tolerance. */
  defaultTriangleCount: number;
  /** The tolerance the refinement stopped at, in source pixels. */
  finalMaxError: number;
};

/** The library-default triangle count per scenario; slow to compute. */
const defaultTriangleCounts = new Map<string, number>();

/** Options for {@link buildScene}. */
export type BuildSceneOptions = {
  /** The image and projections to animate. */
  scenario: Scenario;
  /** Tolerance the recorded refinement stops at, in pixels. */
  finalMaxError: number;
};

/**
 * Record the refinement down to `finalMaxError` pixels and place every vertex
 * and reference line on the slide.
 */
export function buildScene(options: BuildSceneOptions): Scene {
  const { scenario, finalMaxError } = options;
  const { fns, width, height } = scenario;
  const record = recordRefinement(fns, {
    width,
    height,
    maxError: finalMaxError,
  });
  const outline = imageOutlineInTarget(fns, width, height);
  const layout = createLayout({
    imageWidth: width,
    imageHeight: height,
    targetBounds: polylineBounds(outline),
    sourceBox: SOURCE_BOX,
    targetBox: TARGET_BOX,
  });

  const vertexCount = record.uvs.length / 2;
  const sourceXY = new Float32Array(2 * vertexCount);
  const targetXY = new Float32Array(2 * vertexCount);
  const copyXY = new Float32Array(2 * vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const u = record.uvs[2 * i]!;
    const v = record.uvs[2 * i + 1]!;
    sourceXY.set(layout.uvToSource(u, v), 2 * i);
    copyXY.set(layout.uvToCopy(u, v), 2 * i);
    targetXY.set(
      layout.targetToSlide(
        record.positions[2 * i]!,
        record.positions[2 * i + 1]!,
      ),
      2 * i,
    );
  }

  const guessXY = new Float32Array(2 * record.steps.length);
  record.steps.forEach((step, k) => {
    guessXY.set(layout.targetToSlide(...step.split.guess), 2 * k);
  });

  let defaultTriangleCount = defaultTriangleCounts.get(scenario.id);
  if (defaultTriangleCount === undefined) {
    defaultTriangleCount = countTriangles(fns, {
      width,
      height,
      maxError: LIBRARY_DEFAULT_MAX_ERROR,
    });
    defaultTriangleCounts.set(scenario.id, defaultTriangleCount);
  }

  const { parallel } = scenario;
  return {
    scenario,
    layout,
    record,
    sourceXY,
    targetXY,
    copyXY,
    guessXY,
    parallelTarget: parallelPolyline(
      scenario.lngLatToTarget,
      parallel.lat,
      parallel.lngRange,
      parallel.targetSamples,
    ).map(([x, y]) => layout.targetToSlide(x, y)),
    // Fewer points than `outline`: deck.gl restarts the dash pattern on every
    // path segment, so segments shorter than a dash would draw solid.
    outlineTarget: imageOutlineInTarget(
      fns,
      width,
      height,
      scenario.outlineSamples,
    ).map(([x, y]) => layout.targetToSlide(x, y)),
    parallelSource: bakedParallel(scenario).map(([x, y]) =>
      layout.pixelToSource(x, y),
    ),
    defaultTriangleCount,
    finalMaxError,
  };
}

/** The scenario's reference parallel in source pixels, as baked into the texture. */
export function bakedParallel(scenario: Scenario): Polyline {
  const { lat, lngRange } = scenario.parallel;
  return parallelPolyline(scenario.lngLatToPixel, lat, lngRange);
}
