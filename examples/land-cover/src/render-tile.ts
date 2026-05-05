import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import type { Texture } from "@luma.gl/core";
import type { LandCoverTileData } from "./get-tile-data.js";
import {
  CreateTextureUint,
  FilterCategory,
  PaletteColormap,
} from "./gpu-modules/index.js";

/** Inputs to {@link makeRenderTile}. */
export interface MakeRenderTileOptions {
  /** 256×1 RGBA colormap texture (alpha=0 at nodata). */
  colormapTexture: Texture | null;
  /** 256×1 r8 boolean LUT texture for the active category selection. */
  filterLUTTexture: Texture | null;
}

/**
 * Build a `renderTile` callback that wires the integer-aware land-cover
 * pipeline.
 *
 * Returns `null` (skip rendering) until both shared textures are ready.
 * The recent fix in RasterTileLayer (#489) lets `renderTile` return null
 * to signal "no layer this frame".
 */
export function makeRenderTile(
  options: MakeRenderTileOptions,
): (data: LandCoverTileData) => RenderTileResult | null {
  return (data) => {
    const { colormapTexture, filterLUTTexture } = options;
    if (!colormapTexture || !filterLUTTexture) {
      return null;
    }
    return {
      renderPipeline: [
        {
          module: CreateTextureUint,
          props: { textureName: data.texture },
        },
        {
          module: FilterCategory,
          props: { categoryFilterLUT: filterLUTTexture },
        },
        {
          module: PaletteColormap,
          props: { colormapTexture },
        },
      ],
    };
  };
}
