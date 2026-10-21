import type {
  RasterModule,
  UvTransform,
} from "@developmentseed/deck.gl-raster";
import { RasterLayer } from "@developmentseed/deck.gl-raster";
import {
  buildCompositeBandsProps,
  CompositeBands,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Texture } from "@luma.gl/core";
import type { BandId } from "../scene/constants.js";
import type { Rect } from "../scene/layout.js";

/** The textures one composite samples, and the size of its mesh. */
export type CompositeInputs = {
  /** Each band's texture, with where the composite sits inside it. */
  bands: Record<BandId, { texture: Texture; uvTransform: UvTransform }>;
  /** Width and height of the composite, in pixels of its primary texture. */
  size: [number, number];
};

/** The rescale after compositing: 16-bit values 0-4000 onto 0-1. */
export const COMPOSITE_RESCALE = { rescaleMin: 0, rescaleMax: 4000 / 65535 };

/** Every layer is flat on the slide, so layers draw in list order. */
export const ON_TOP = { depthCompare: "always" } as const;

/** Which band fills which channel, as in the spec. */
const MAPPING = { r: "b11", g: "b04", b: "b01" };

const identity = (x: number, y: number): [number, number] => [x, y];

/**
 * The mesh lives in the composite's own pixels, with no reprojection: the
 * explainer's map is flat. One shared object, so the mesh is built once.
 */
const PIXEL_SPACE = {
  forwardTransform: identity,
  inverseTransform: identity,
  forwardReproject: identity,
  inverseReproject: identity,
};

/** One render pipeline per set of inputs, so the shader isn't rebuilt. */
const pipelines = new WeakMap<CompositeInputs, RasterModule[]>();

function pipelineFor(inputs: CompositeInputs): RasterModule[] {
  let pipeline = pipelines.get(inputs);
  if (!pipeline) {
    const bands = new Map(Object.entries(inputs.bands));
    pipeline = [
      {
        module: CompositeBands as RasterModule["module"],
        props: buildCompositeBandsProps(
          MAPPING,
          bands,
        ) as RasterModule["props"],
      },
      {
        module: LinearRescale as RasterModule["module"],
        props: COMPOSITE_RESCALE,
      },
    ];
    pipelines.set(inputs, pipeline);
  }
  return pipeline;
}

/**
 * Draw a composite into `rect` with deck.gl-raster's `RasterLayer` and the
 * same pipeline `MultiCOGLayer` uses: `CompositeBands`, then `LinearRescale`.
 * The rect is applied with `modelMatrix`, so moving it never rebuilds the
 * mesh.
 */
export function compositeLayer(options: {
  id: string;
  inputs: CompositeInputs;
  rect: Rect;
  opacity?: number;
}): RasterLayer {
  const { id, inputs, rect, opacity = 1 } = options;
  const [width, height] = inputs.size;
  return new RasterLayer({
    id,
    width,
    height,
    reprojectionFns: PIXEL_SPACE,
    renderPipeline: pipelineFor(inputs),
    coordinateSystem: "cartesian",
    // Column-major: scale pixels to the rect, then move to its corner.
    modelMatrix: [
      rect.width / width,
      0,
      0,
      0,
      0,
      rect.height / height,
      0,
      0,
      0,
      0,
      1,
      0,
      rect.x,
      rect.y,
      0,
      1,
    ],
    opacity,
    parameters: ON_TOP,
  });
}
