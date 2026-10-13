import type { Layout } from "./layout.js";
import { createLayout, SOURCE_BOX, TARGET_BOX } from "./layout.js";
import type { Polyline } from "./lines.js";
import {
  imageOutlineInWebMercator,
  parallelInPixels,
  parallelInWebMercator,
  polylineBounds,
} from "./lines.js";
import { NLCD_HEIGHT, NLCD_TO_WEB_MERCATOR, NLCD_WIDTH } from "./nlcd.js";
import type { RefinementRecord } from "./refinement.js";
import { countTriangles, recordRefinement } from "./refinement.js";

/** Latitude of the parallel the animation tracks: the US–Canada border. */
export const PARALLEL_LAT = 49;

/** Longitudes the parallel is drawn across: the image's top corners. */
export const PARALLEL_LNG_RANGE: [number, number] = [-129.3, -63.1];

/** Points per image edge in the displayed (dashed) footprint outline. */
const OUTLINE_DISPLAY_SAMPLES = 12;

/** The library's default mesh tolerance, in source pixels. */
export const LIBRARY_DEFAULT_MAX_ERROR = 0.125;

/** Everything the animation needs, precomputed in slide units. */
export type Scene = {
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
  /** The true 49th parallel on the target panel. */
  parallelTarget: Polyline;
  /** The true outline of the image on the target panel. */
  outlineTarget: Polyline;
  /** The 49th parallel on the source panel. */
  parallelSource: Polyline;
  /** Triangles the library builds for this image at its default tolerance. */
  defaultTriangleCount: number;
  /** The tolerance the refinement stopped at, in source pixels. */
  finalMaxError: number;
};

let defaultTriangleCountCache: number | undefined;

/**
 * Record the refinement down to `finalMaxError` source pixels and place every
 * vertex and reference line on the slide.
 */
export function buildScene(options: { finalMaxError: number }): Scene {
  const record = recordRefinement(NLCD_TO_WEB_MERCATOR, {
    width: NLCD_WIDTH,
    height: NLCD_HEIGHT,
    maxError: options.finalMaxError,
  });
  const outline = imageOutlineInWebMercator(NLCD_WIDTH, NLCD_HEIGHT);
  const layout = createLayout({
    imageWidth: NLCD_WIDTH,
    imageHeight: NLCD_HEIGHT,
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

  defaultTriangleCountCache ??= countTriangles(NLCD_TO_WEB_MERCATOR, {
    width: NLCD_WIDTH,
    height: NLCD_HEIGHT,
    maxError: LIBRARY_DEFAULT_MAX_ERROR,
  });

  return {
    layout,
    record,
    sourceXY,
    targetXY,
    copyXY,
    guessXY,
    parallelTarget: parallelInWebMercator(
      PARALLEL_LAT,
      PARALLEL_LNG_RANGE,
      2,
    ).map(([x, y]) => layout.targetToSlide(x, y)),
    // Fewer points than `outline`: deck.gl restarts the dash pattern on every
    // path segment, so segments shorter than a dash would draw solid.
    outlineTarget: imageOutlineInWebMercator(
      NLCD_WIDTH,
      NLCD_HEIGHT,
      OUTLINE_DISPLAY_SAMPLES,
    ).map(([x, y]) => layout.targetToSlide(x, y)),
    parallelSource: bakedParallel().map(([x, y]) => layout.pixelToSource(x, y)),
    defaultTriangleCount: defaultTriangleCountCache,
    finalMaxError: options.finalMaxError,
  };
}

/** The 49th parallel in source pixels, as baked into the texture. */
export function bakedParallel(): Polyline {
  return parallelInPixels(PARALLEL_LAT, PARALLEL_LNG_RANGE);
}
