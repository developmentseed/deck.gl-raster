import type { Layout } from "./layout.js";
import { createLayout, SOURCE_BOX, TARGET_BOX } from "./layout.js";
import type { Bounds, Polyline } from "./lines.js";
import {
  imageOutlineInWebMercator,
  meridianInPixels,
  polylineBounds,
} from "./lines.js";
import type { RefinementRecord } from "./refinement.js";
import { countTriangles, recordRefinement } from "./refinement.js";
import {
  UTM_HEIGHT,
  UTM_TO_WEB_MERCATOR,
  UTM_WIDTH,
  WORLD_WIDTH,
} from "./utm60n.js";

/** Latitudes the 180° meridian is drawn across in the source image. */
export const MERIDIAN_LAT_RANGE: [number, number] = [47, 57];

/** Points per image edge in the displayed (dashed) footprint outline. */
const OUTLINE_DISPLAY_SAMPLES = 12;

/** How much of a world the world view shows: a little past both edges. */
const WORLD_VIEW_SPAN = 1.2;

/** The library's default mesh tolerance, in source pixels. */
export const LIBRARY_DEFAULT_MAX_ERROR = 0.125;

/** Everything the animation needs, precomputed in slide units. */
export type Scene = {
  /** Panel placement, zoomed in on the image's footprint. */
  layout: Layout;
  /** Panel placement with the whole Web Mercator world on the target panel. */
  worldLayout: Layout;
  /** The recorded refinement, with `wrapX`, from the seed to the final mesh. */
  record: RefinementRecord;
  /** Every vertex of the final mesh on the source panel, 2 per vertex. */
  sourceXY: Float32Array;
  /** Every vertex at its exact, unwrapped position on the target panel. */
  targetXY: Float32Array;
  /** The same, in the world view. */
  worldXY: Float32Array;
  /**
   * Every vertex in the world view at its exact x as proj4 returns it,
   * wrapped into one world. Only the seed corners are used.
   */
  worldRawXY: Float32Array;
  /** Every vertex on the source-sized copy centred on the target panel. */
  copyXY: Float32Array;
  /** The same, centred on the world view. */
  worldCopyXY: Float32Array;
  /**
   * Where the GPU drew each step's split point before the split (its linear
   * guess), on the target panel, 2 per step.
   */
  guessXY: Float32Array;
  /** The 180° meridian on the target panel. */
  meridianTarget: Polyline;
  /** The ±180° world edges in the world view: east (+180°), then west. */
  edgesWorld: [Polyline, Polyline];
  /** The true outline of the image on the target panel. */
  outlineTarget: Polyline;
  /** The same, in the world view. */
  outlineWorld: Polyline;
  /** The 180° meridian on the source panel. */
  meridianSource: Polyline;
  /** The 2-triangle seed's error without `wrapX`, in source pixels. */
  wrappedSeedMaxError: number;
  /** Triangles the library builds for this image at its default tolerance. */
  defaultTriangleCount: number;
  /** The tolerance the refinement stopped at, in source pixels. */
  finalMaxError: number;
};

let defaultTriangleCountCache: number | undefined;

/**
 * Record the refinement down to `finalMaxError` source pixels and place every
 * vertex and reference line on the slide, in both target views.
 */
export function buildScene(options: { finalMaxError: number }): Scene {
  const record = recordRefinement(UTM_TO_WEB_MERCATOR, {
    width: UTM_WIDTH,
    height: UTM_HEIGHT,
    maxError: options.finalMaxError,
    wrapX: WORLD_WIDTH,
  });
  const outline = imageOutlineInWebMercator(UTM_WIDTH, UTM_HEIGHT);
  const footprint = polylineBounds(outline);
  const layoutFor = (targetBounds: Bounds) =>
    createLayout({
      imageWidth: UTM_WIDTH,
      imageHeight: UTM_HEIGHT,
      targetBounds,
      sourceBox: SOURCE_BOX,
      targetBox: TARGET_BOX,
    });
  const layout = layoutFor(footprint);
  const worldWidth = WORLD_VIEW_SPAN * WORLD_WIDTH;
  const worldHeight = (worldWidth * TARGET_BOX.height) / TARGET_BOX.width;
  const centerY = (footprint[1] + footprint[3]) / 2;
  const worldMinY = centerY - worldHeight / 2;
  const worldMaxY = centerY + worldHeight / 2;
  const worldLayout = layoutFor([
    -worldWidth / 2,
    worldMinY,
    worldWidth / 2,
    worldMaxY,
  ]);

  const vertexCount = record.uvs.length / 2;
  const sourceXY = new Float32Array(2 * vertexCount);
  const targetXY = new Float32Array(2 * vertexCount);
  const worldXY = new Float32Array(2 * vertexCount);
  const worldRawXY = new Float32Array(2 * vertexCount);
  const copyXY = new Float32Array(2 * vertexCount);
  const worldCopyXY = new Float32Array(2 * vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const u = record.uvs[2 * i]!;
    const v = record.uvs[2 * i + 1]!;
    const x = record.positions[2 * i]!;
    const y = record.positions[2 * i + 1]!;
    sourceXY.set(layout.uvToSource(u, v), 2 * i);
    copyXY.set(layout.uvToCopy(u, v), 2 * i);
    worldCopyXY.set(worldLayout.uvToCopy(u, v), 2 * i);
    targetXY.set(layout.targetToSlide(x, y), 2 * i);
    worldXY.set(worldLayout.targetToSlide(x, y), 2 * i);
    worldRawXY.set(
      worldLayout.targetToSlide(record.seedRawX[i] ?? x, y),
      2 * i,
    );
  }

  const guessXY = new Float32Array(2 * record.steps.length);
  record.steps.forEach((step, k) => {
    guessXY.set(layout.targetToSlide(...step.split.guess), 2 * k);
  });

  defaultTriangleCountCache ??= countTriangles(UTM_TO_WEB_MERCATOR, {
    width: UTM_WIDTH,
    height: UTM_HEIGHT,
    maxError: LIBRARY_DEFAULT_MAX_ERROR,
    wrapX: WORLD_WIDTH,
  });

  // Fewer points than `outline`: deck.gl restarts the dash pattern on every
  // path segment, so segments shorter than a dash would draw solid.
  const displayOutline = imageOutlineInWebMercator(
    UTM_WIDTH,
    UTM_HEIGHT,
    OUTLINE_DISPLAY_SAMPLES,
  );
  const edge = (
    x: number,
    minY: number,
    maxY: number,
    to: Layout,
  ): Polyline => [to.targetToSlide(x, minY), to.targetToSlide(x, maxY)];

  return {
    layout,
    worldLayout,
    record,
    sourceXY,
    targetXY,
    worldXY,
    worldRawXY,
    copyXY,
    worldCopyXY,
    guessXY,
    meridianTarget: edge(WORLD_WIDTH / 2, footprint[1], footprint[3], layout),
    edgesWorld: [
      edge(WORLD_WIDTH / 2, worldMinY, worldMaxY, worldLayout),
      edge(-WORLD_WIDTH / 2, worldMinY, worldMaxY, worldLayout),
    ],
    outlineTarget: displayOutline.map(([x, y]) => layout.targetToSlide(x, y)),
    outlineWorld: displayOutline.map(([x, y]) =>
      worldLayout.targetToSlide(x, y),
    ),
    meridianSource: bakedMeridian().map(([x, y]) => layout.pixelToSource(x, y)),
    wrappedSeedMaxError: recordRefinement(UTM_TO_WEB_MERCATOR, {
      width: UTM_WIDTH,
      height: UTM_HEIGHT,
      maxError: 0,
      maxSteps: 0,
    }).seedMaxError,
    defaultTriangleCount: defaultTriangleCountCache,
    finalMaxError: options.finalMaxError,
  };
}

/** The 180° meridian in source pixels, as baked into the texture. */
export function bakedMeridian(): Polyline {
  return meridianInPixels(180, MERIDIAN_LAT_RANGE);
}
