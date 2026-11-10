import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import type { Texture } from "@luma.gl/core";
import { ClusterOverlay } from "../gpu/cluster-overlay.js";
import { SampleAefRgb } from "../gpu/sample-aef-rgb.js";
import { ValueOverlay } from "../gpu/value-overlay.js";
import type { AefTileData } from "./get-tile-data.js";

/** The RGB composite drawn under every overlay. */
export type RgbSettings = {
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

/** How to draw model output over the RGB composite. */
export type OverlaySettings =
  | {
      /** Draw the RGB composite only. */
      kind: "none";
    }
  | {
      /** Draw a similarity or probability through a colormap. */
      kind: "value";
      /** The model whose output to draw. */
      model: "similarity" | "classifier";
      /** The colormap sprite texture. */
      colormapTexture: Texture;
      /** Layer of the colormap sprite. */
      colormapIndex: number;
      /** Value drawn with the first colormap color. */
      rangeMin: number;
      /** Value drawn with the last colormap color. */
      rangeMax: number;
      /** Values below this show the dimmed RGB composite. */
      threshold: number;
      /** Brightness of the RGB composite below the threshold. */
      backdrop: number;
    }
  | {
      /** Draw cluster indices with categorical colors. */
      kind: "clusters";
      /** How much the cluster colors cover the RGB composite. */
      opacity: number;
    };

/**
 * Build a `renderTile` callback: the RGB composite, then the overlay if the
 * tile's texture holds output of the overlay's model. A tile still waiting
 * for its first run draws the composite alone.
 */
export function makeRenderTile(rgb: RgbSettings, overlay: OverlaySettings) {
  return function renderTile(data: AefTileData): RenderTileResult {
    const base = {
      module: SampleAefRgb,
      props: { dataTex: data.bandTexture, ...rgb },
    };
    if (overlay.kind === "none") {
      return { renderPipeline: [base] };
    }
    const model = overlay.kind === "clusters" ? "clusters" : overlay.model;
    if (data.result?.model !== model) {
      return { renderPipeline: [base] };
    }
    if (overlay.kind === "clusters") {
      return {
        renderPipeline: [
          base,
          {
            module: ClusterOverlay,
            props: { clusterTex: data.valueTexture, opacity: overlay.opacity },
          },
        ],
      };
    }
    return {
      renderPipeline: [
        base,
        {
          module: ValueOverlay,
          props: {
            valueTex: data.valueTexture,
            colormapTexture: overlay.colormapTexture,
            colormapIndex: overlay.colormapIndex,
            rangeMin: overlay.rangeMin,
            rangeMax: overlay.rangeMax,
            threshold: overlay.threshold,
            backdrop: overlay.backdrop,
          },
        },
      ],
    };
  };
}
