import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Texture } from "@luma.gl/core";
import type { TerrainTileData } from "./get-tile-data.js";
import {
  ElevationScalar,
  Hillshade,
  MultiplyShade,
  SlopeDegrees,
  TerrainDerivative,
} from "./gpu-modules/index.js";

/** How the elevation is turned into pixels. */
export type RenderMode = "tinted-relief" | "hillshade" | "slope" | "elevation";

/** Labels for the mode dropdown, in display order. */
export const RENDER_MODES: ReadonlyArray<{
  id: RenderMode;
  label: string;
}> = [
  { id: "tinted-relief", label: "Tinted relief" },
  { id: "hillshade", label: "Hillshade" },
  { id: "slope", label: "Slope" },
  { id: "elevation", label: "Elevation" },
];

/** Arguments for {@link makeRenderTile}. */
export interface MakeRenderTileOptions {
  /** Which visualization to build a pipeline for. */
  mode: RenderMode;
  /** Sun direction in compass degrees, clockwise from north. */
  sunAzimuth: number;
  /** Sun height in degrees above the horizon. */
  sunAltitude: number;
  /** Vertical exaggeration applied to the gradient. */
  zFactor: number;
  /** Colormap sprite texture, or `null` until it has been uploaded. */
  colormapTexture: Texture | null;
  /** Which layer of the sprite to sample. */
  colormapIndex: number;
  /** Whether to sample the colormap in reverse. */
  colormapReversed: boolean;
  /** Low end of the colormap range, in the active mode's units. */
  rescaleMin: number;
  /** High end of the colormap range, in the active mode's units. */
  rescaleMax: number;
  /** How strongly relief shading is mixed into tinted relief. */
  shadeStrength: number;
}

/**
 * Build a `renderTile` callback for the current controls.
 *
 * Every pipeline begins with {@link TerrainDerivative} — the head module that
 * owns the halo texture and runs the 3×3 kernel — rather than the library's
 * `CreateTexture`, which samples without the halo inset. The scalar modes then
 * hand off to the library's own `LinearRescale` and `Colormap`.
 *
 * Returns `null` for a tile when a colormap is needed but not yet uploaded,
 * which skips rendering that tile until it is.
 */
export function makeRenderTile(
  options: MakeRenderTileOptions,
): (data: TerrainTileData) => RenderTileResult | null {
  const {
    mode,
    sunAzimuth,
    sunAltitude,
    zFactor,
    colormapTexture,
    colormapIndex,
    colormapReversed,
    rescaleMin,
    rescaleMax,
    shadeStrength,
  } = options;

  return (data) => {
    const derivative = {
      module: TerrainDerivative,
      props: {
        elevationTexture: data.texture,
        tileSize: [data.width, data.height] as [number, number],
        cellSize: data.cellSize,
        nodata: data.nodata,
        zFactor,
        sunAzimuth,
        sunAltitude,
      },
    };

    if (mode === "hillshade") {
      return { renderPipeline: [derivative, { module: Hillshade }] };
    }

    if (!colormapTexture) {
      return null;
    }

    const scalar = mode === "slope" ? SlopeDegrees : ElevationScalar;
    const colorize = [
      { module: scalar },
      { module: LinearRescale, props: { rescaleMin, rescaleMax } },
      {
        module: Colormap,
        props: {
          colormapTexture,
          colormapIndex,
          reversed: colormapReversed,
        },
      },
    ];

    if (mode === "tinted-relief") {
      return {
        renderPipeline: [
          derivative,
          ...colorize,
          { module: MultiplyShade, props: { shadeStrength } },
        ],
      };
    }

    return { renderPipeline: [derivative, ...colorize] };
  };
}
