import type { Texture } from "@luma.gl/core";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import { SampleTexture2DArray } from "../gpu/sample-texture-2d-array.js";
import type { EcmwfTileData } from "./get-tile-data.js";

/**
 * Arguments for {@link makeRenderTile}.
 */
export type MakeRenderTileArgs = {
  /** Current animation frame (0 .. depth-1). */
  layerIndex: number;
  /** Colormap texture (shared across tiles). */
  colormapTexture: Texture;
  /** Minimum value for rescale (same units as the variable). */
  rescaleMin: number;
  /** Maximum value for rescale. */
  rescaleMax: number;
};

/**
 * Build a renderTile callback closed over the current animation state and
 * shared resources. A new closure is created on each React render, but
 * deck.gl's prop diff (compare:true on renderPipeline) ensures only the
 * changed uniforms flow through.
 */
export function makeRenderTile(args: MakeRenderTileArgs) {
  const { layerIndex, colormapTexture, rescaleMin, rescaleMax } = args;
  return function renderTile(data: EcmwfTileData): RenderTileResult {
    return {
      renderPipeline: [
        {
          module: SampleTexture2DArray,
          props: { dataTex: data.texture, layerIndex },
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
