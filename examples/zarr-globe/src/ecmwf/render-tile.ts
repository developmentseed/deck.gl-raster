import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Texture } from "@luma.gl/core";
import { FilterRange } from "../gpu/filter-range.js";
import { SampleTexture2DArray } from "../gpu/sample-texture-2d-array.js";
import type { EcmwfTileData } from "./get-tile-data.js";

/**
 * Arguments for {@link makeRenderTile}.
 */
export type MakeRenderTileArgs = {
  /** Current animation frame (0 .. depth-1). */
  layerIndex: number;
  /** Colormap sprite texture (2d-array; shared across tiles). */
  colormapTexture: Texture;
  /** Which layer of the sprite to sample. */
  colormapIndex: number;
  /** Whether to reverse the colormap. */
  colormapReversed: boolean;
  /** Minimum value to keep (inclusive). Pixels below are discarded. */
  filterMin: number;
  /** Maximum value to keep (inclusive). Pixels above are discarded. */
  filterMax: number;
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
  const {
    layerIndex,
    colormapTexture,
    colormapIndex,
    colormapReversed,
    filterMin,
    filterMax,
    rescaleMin,
    rescaleMax,
  } = args;
  return function renderTile(data: EcmwfTileData): RenderTileResult {
    return {
      renderPipeline: [
        {
          module: SampleTexture2DArray,
          props: { dataTex: data.texture, layerIndex },
        },
        // FilterRange runs on the raw scalar (still in `color.r`) before
        // LinearRescale clamps it to [0, 1].
        {
          module: FilterRange,
          props: { filterMin, filterMax },
        },
        {
          module: LinearRescale,
          props: { rescaleMin, rescaleMax },
        },
        {
          module: Colormap,
          props: {
            colormapTexture,
            colormapIndex,
            reversed: colormapReversed,
          },
        },
      ],
    };
  };
}
