import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Texture } from "@luma.gl/core";
import { SampleTexture2DArray } from "../gpu/sample-texture-2d-array.js";
import type { AnomalyTileData } from "./get-tile-data.js";

export type MakeRenderTileArgs = {
  /** Current date index (0 .. DATE_COUNT-1). */
  dateIdx: number;
  colormapTexture: Texture;
  rescaleMin: number;
  rescaleMax: number;
};

export function makeRenderTile(args: MakeRenderTileArgs) {
  const { dateIdx, colormapTexture, rescaleMin, rescaleMax } = args;
  return function renderTile(data: AnomalyTileData): RenderTileResult {
    return {
      renderPipeline: [
        {
          module: SampleTexture2DArray,
          props: { dataTex: data.texture, layerIndex: dateIdx },
        },
        {
          module: LinearRescale,
          props: { rescaleMin, rescaleMax },
        },
        {
          module: Colormap,
          props: { colormapTexture },
        },
      ],
    };
  };
}
