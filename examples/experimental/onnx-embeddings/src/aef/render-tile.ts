import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import { ClusterOverlay } from "../gpu/cluster-overlay.js";
import { SampleAefRgb } from "../gpu/sample-aef-rgb.js";
import { ValueOverlay } from "../gpu/value-overlay.js";
import type { AefTileData } from "./get-tile-data.js";

/** The RGB composite of three embedding bands. */
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

/** What each tile draws over the basemap. */
export type TileView =
  | {
      /** Draw the RGB composite. */
      kind: "rgb";
    }
  | {
      /** Draw nothing: a model mode with no result to show yet. */
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
      /** Pixels with a value below this are not drawn. */
      threshold: number;
      /** Opacity of the drawn pixels, 0 to 1. */
      opacity: number;
    }
  | {
      /** Draw cluster indices with categorical colors. */
      kind: "clusters";
      /** Opacity of the cluster colors, 0 to 1. */
      opacity: number;
    };

/** Brightness of the RGB composite when it is drawn under model output. */
export const BACKDROP_BRIGHTNESS = 0.45;

/** A shader module that draws nothing. */
const Hidden = {
  name: "hidden",
  inject: { "fs:DECKGL_FILTER_COLOR": "discard;" },
} as const satisfies ShaderModule;

/** A shader module that darkens the color to `brightness`, 0 to 1. */
const Dim = {
  name: "dim",
  fs: `\
uniform dimUniforms {
  float brightness;
} dim;
`,
  inject: { "fs:DECKGL_FILTER_COLOR": "color.rgb *= dim.brightness;" },
  uniformTypes: { brightness: "f32" },
  getUniforms: (props: { brightness?: number }) => ({
    brightness: props.brightness ?? 1,
  }),
} as const satisfies ShaderModule<{ brightness: number }>;

/**
 * Build a `renderTile` callback for `view`.
 *
 * `backdrop` is the brightness of the RGB composite under model output, 0 to
 * 1. At 0 the composite is not drawn: the basemap shows wherever a pixel has
 * no output, and a tile whose texture doesn't hold output of the view's model
 * yet draws nothing. The composite still runs first in every pipeline,
 * because it discards nodata pixels.
 */
export function makeRenderTile(
  rgb: RgbSettings,
  view: TileView,
  backdrop: number,
) {
  return function renderTile(data: AefTileData): RenderTileResult {
    const composite = {
      module: SampleAefRgb,
      props: { dataTex: data.bandTexture, ...rgb },
    };
    if (view.kind === "rgb") {
      return { renderPipeline: [composite] };
    }
    const noOutput =
      backdrop > 0
        ? { module: Dim, props: { brightness: backdrop } }
        : { module: Hidden, props: {} };
    if (view.kind === "none") {
      return { renderPipeline: [composite, noOutput] };
    }
    const model = view.kind === "clusters" ? "clusters" : view.model;
    if (data.result?.model !== model) {
      return { renderPipeline: [composite, noOutput] };
    }
    if (view.kind === "clusters") {
      return {
        renderPipeline: [
          composite,
          {
            module: ClusterOverlay,
            props: {
              clusterTex: data.valueTexture,
              opacity: view.opacity,
              backdrop,
            },
          },
        ],
      };
    }
    return {
      renderPipeline: [
        composite,
        {
          module: ValueOverlay,
          props: {
            valueTex: data.valueTexture,
            colormapTexture: view.colormapTexture,
            colormapIndex: view.colormapIndex,
            rangeMin: view.rangeMin,
            rangeMax: view.rangeMax,
            threshold: view.threshold,
            opacity: view.opacity,
            backdrop,
          },
        },
      ],
    };
  };
}
