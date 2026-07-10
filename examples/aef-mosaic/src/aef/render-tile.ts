import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import { SampleAefRgb } from "../gpu/sample-aef-rgb.js";
import type { AefTileData } from "./get-tile-data.js";

/**
 * Arguments for {@link makeRenderTile}.
 */
export type MakeRenderTileArgs = {
  /** Layer index sampled for the red channel (0..63). */
  rBandIdx: number;
  /** Layer index sampled for the green channel (0..63). */
  gBandIdx: number;
  /** Layer index sampled for the blue channel (0..63). */
  bBandIdx: number;
  /** Lower bound of the dequantized-value rescale range. */
  rescaleMin: number;
  /** Upper bound of the dequantized-value rescale range. */
  rescaleMax: number;
};

/**
 * Build a `renderTile` callback closed over the current band triad + rescale
 * range. A new closure is created on each render; deck.gl's prop diff on
 * `renderPipeline` ensures only changed uniforms flow through.
 */
export function makeRenderTile(args: MakeRenderTileArgs) {
  const { rBandIdx, gBandIdx, bBandIdx, rescaleMin, rescaleMax } = args;
  return function renderTile(data: AefTileData): RenderTileResult {
    return {
      renderPipeline: [
        {
          module: SampleAefRgb,
          props: {
            dataTex: data.texture,
            rBandIdx,
            gBandIdx,
            bBandIdx,
            rescaleMin,
            rescaleMax,
          },
        },
      ],
    };
  };
}
