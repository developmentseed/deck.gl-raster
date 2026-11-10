import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Props for the {@link ValueOverlay} shader module.
 */
export type ValueOverlayProps = {
  /** r32float texture with one model output value per pixel. */
  valueTex: Texture;
  /** The colormap sprite as a 2D array texture, one colormap per layer. */
  colormapTexture: Texture;
  /** Layer of `colormapTexture` to sample. */
  colormapIndex: number;
  /** Value drawn with the first colormap color. */
  rangeMin: number;
  /** Value drawn with the last colormap color. */
  rangeMax: number;
  /** Pixels with a value below this are not drawn. */
  threshold: number;
  /** Opacity of the drawn pixels, 0 to 1. */
  opacity: number;
};

const MODULE_NAME = "valueOverlay";

/**
 * A shader module that replaces the tile's color: pixels whose model value is
 * at least `threshold` take the colormap color of the value rescaled from
 * `[rangeMin, rangeMax]`, at `opacity`. The rest are not drawn.
 */
export const ValueOverlay = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  float rangeMin;
  float rangeMax;
  float threshold;
  float opacity;
  int colormapIndex;
} ${MODULE_NAME};
`,
  inject: {
    "fs:#decl": `
precision highp sampler2DArray;
uniform sampler2D valueTex;
uniform sampler2DArray valueColormapTex;
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float valueOverlay_value = texture(valueTex, geometry.uv).r;
      if (valueOverlay_value < ${MODULE_NAME}.threshold) {
        discard;
      }
      float valueOverlay_t = clamp(
        (valueOverlay_value - ${MODULE_NAME}.rangeMin) /
          (${MODULE_NAME}.rangeMax - ${MODULE_NAME}.rangeMin),
        0.0,
        1.0
      );
      color = vec4(
        texture(
          valueColormapTex,
          vec3(valueOverlay_t, 0.5, float(${MODULE_NAME}.colormapIndex))
        ).rgb,
        ${MODULE_NAME}.opacity
      );
    `,
  },
  uniformTypes: {
    rangeMin: "f32",
    rangeMax: "f32",
    threshold: "f32",
    opacity: "f32",
    colormapIndex: "i32",
  },
  getUniforms: (props: Partial<ValueOverlayProps>) => {
    return {
      rangeMin: props.rangeMin ?? 0,
      rangeMax: props.rangeMax ?? 1,
      threshold: props.threshold ?? 0,
      opacity: props.opacity ?? 1,
      colormapIndex: props.colormapIndex ?? 0,
      valueTex: props.valueTex,
      valueColormapTex: props.colormapTexture,
    };
  },
} as const satisfies ShaderModule<ValueOverlayProps>;
