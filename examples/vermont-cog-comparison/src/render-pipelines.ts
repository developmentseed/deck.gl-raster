import type {
  RasterModule,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import {
  BlackIsZero,
  Colormap,
  CreateTexture,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Texture } from "@luma.gl/core";
import { Ndvi, SetAlpha1, SetFalseColorInfrared } from "./shaders.js";
import type { TileTextureData } from "./tile-loaders.js";

/**
 * Render pipeline for true-color RGB tiles (3- and 4-band sources).
 * Forces alpha to 1.0 so 4-band NIR-in-alpha sources render opaquely.
 */
export function renderRGB(tileData: TileTextureData): RenderTileResult {
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: tileData.texture } },
    { module: SetAlpha1 },
  ];
  return { renderPipeline };
}

/**
 * Render pipeline for false-color infrared (4-band sources only).
 */
export function renderFalseColor(tileData: TileTextureData): RenderTileResult {
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: tileData.texture } },
    { module: SetFalseColorInfrared },
    { module: SetAlpha1 },
  ];
  return { renderPipeline };
}

/**
 * Render pipeline for 1-band grayscale (BlackIsZero photometric).
 *
 * Broadcasts the single-channel value into RGB then forces alpha to 1.0.
 */
export function renderGrayscale(tileData: TileTextureData): RenderTileResult {
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: tileData.texture } },
    { module: BlackIsZero },
    { module: SetAlpha1 },
  ];
  return { renderPipeline };
}

/** Fixed inputs for the NDVI render pipeline. */
export type RenderNDVIOptions = {
  /** Decoded sprite holding all available colormaps. */
  colormapTexture: Texture;
  /** Layer index into `colormapTexture` selecting the NDVI colormap. */
  colormapIndex: number;
};

/**
 * Render pipeline for NDVI (4-band sources only).
 *
 * Computes NDVI per pixel, then samples a colormap to colorize the value.
 * No range filter — the spec calls for fixed colormap, no slider UI.
 */
export function renderNDVI(
  tileData: TileTextureData,
  options: RenderNDVIOptions,
): RenderTileResult {
  const { colormapTexture, colormapIndex } = options;
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: tileData.texture } },
    { module: Ndvi },
    {
      module: Colormap,
      props: { colormapTexture, colormapIndex, reversed: false },
    },
    { module: SetAlpha1 },
  ];
  return { renderPipeline };
}
