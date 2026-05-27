import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  CreateTexture,
  FilterNoDataVal,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Texture } from "@luma.gl/core";
import type { NldasTileData } from "./get-tile-data.js";

/** Arguments for {@link makeRenderTile}. */
export type MakeRenderTileArgs = {
  /** Colormap sprite texture (2d-array; shared across tiles). */
  colormapTexture: Texture;
  /** Which layer of the sprite to sample. */
  colormapIndex: number;
  /** Whether to reverse the colormap. */
  colormapReversed: boolean;
  /** Sentinel value to discard (set by getTileData on fill/NaN pixels). */
  noDataValue: number;
  /** Minimum value for rescale (variable units). */
  rescaleMin: number;
  /** Maximum value for rescale. */
  rescaleMax: number;
};

/**
 * Build a renderTile callback that samples the tile's float texture, discards
 * nodata, rescales to [0, 1], and applies a colormap — all on the GPU.
 */
export function makeRenderTile(args: MakeRenderTileArgs) {
  const {
    colormapTexture,
    colormapIndex,
    colormapReversed,
    noDataValue,
    rescaleMin,
    rescaleMax,
  } = args;
  return function renderTile(data: NldasTileData): RenderTileResult {
    return {
      renderPipeline: [
        // r32float sample → color = vec4(value, 0, 0, 1)
        { module: CreateTexture, props: { textureName: data.texture } },
        // Discard fills on the raw value before rescale clamps it.
        { module: FilterNoDataVal, props: { value: noDataValue } },
        { module: LinearRescale, props: { rescaleMin, rescaleMax } },
        {
          module: Colormap,
          props: { colormapTexture, colormapIndex, reversed: colormapReversed },
        },
      ],
    };
  };
}
