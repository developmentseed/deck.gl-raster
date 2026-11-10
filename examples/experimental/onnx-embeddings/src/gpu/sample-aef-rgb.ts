import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Props for the {@link SampleAefRgb} shader module.
 */
export type SampleAefRgbProps = {
  /**
   * r8sint Texture2DArray; one layer per AEF band (depth = 64). Each texel
   * stores the raw int8 value from the zarr chunk.
   */
  dataTex: Texture;
  /** Layer index sampled for the red channel (0..63). */
  rBandIdx: number;
  /** Layer index sampled for the green channel (0..63). */
  gBandIdx: number;
  /** Layer index sampled for the blue channel (0..63). */
  bBandIdx: number;
  /**
   * Lower bound of the dequantized-value rescale range. Values at or below
   * this map to 0 in the output channel.
   */
  rescaleMin: number;
  /**
   * Upper bound of the dequantized-value rescale range. Values at or above
   * this map to 1.
   */
  rescaleMax: number;
};

const MODULE_NAME = "sampleAefRgb";

/**
 * A shader module that samples three layers of an `r8sint` Texture2DArray,
 * dequantizes the raw int8 values via `(v/127.5)² · sign(v)`, rescales each
 * channel linearly from `[rescaleMin, rescaleMax]` to `[0, 1]`, and writes
 * the resulting `vec3` to `color.rgb`. Pixels whose sampled value equals the
 * nodata sentinel `-128` on any channel are discarded.
 */
export const SampleAefRgb = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  int rBandIdx;
  int gBandIdx;
  int bBandIdx;
  float rescaleMin;
  float rescaleMax;
} ${MODULE_NAME};
`,
  inject: {
    "fs:#decl": `
precision highp isampler2DArray;
uniform highp isampler2DArray dataTex;

int sampleAefRgb_fetchBand(vec2 uv, int band) {
  return texture(dataTex, vec3(uv, float(band))).r;
}

float sampleAefRgb_dequant(int v) {
  float f = float(v) / 127.5;
  return f * f * sign(f);
}
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      int ri = sampleAefRgb_fetchBand(geometry.uv, ${MODULE_NAME}.rBandIdx);
      int gi = sampleAefRgb_fetchBand(geometry.uv, ${MODULE_NAME}.gBandIdx);
      int bi = sampleAefRgb_fetchBand(geometry.uv, ${MODULE_NAME}.bBandIdx);
      if (ri == -128 || gi == -128 || bi == -128) discard;
      vec3 rgb = vec3(
        sampleAefRgb_dequant(ri),
        sampleAefRgb_dequant(gi),
        sampleAefRgb_dequant(bi)
      );
      float invSpan = 1.0 / (${MODULE_NAME}.rescaleMax - ${MODULE_NAME}.rescaleMin);
      rgb = clamp((rgb - ${MODULE_NAME}.rescaleMin) * invSpan, 0.0, 1.0);
      color = vec4(rgb, 1.0);
    `,
  },
  uniformTypes: {
    rBandIdx: "i32",
    gBandIdx: "i32",
    bBandIdx: "i32",
    rescaleMin: "f32",
    rescaleMax: "f32",
  },
  getUniforms: (props: Partial<SampleAefRgbProps>) => {
    return {
      rBandIdx: props.rBandIdx ?? 0,
      gBandIdx: props.gBandIdx ?? 1,
      bBandIdx: props.bBandIdx ?? 2,
      rescaleMin: props.rescaleMin ?? -0.3,
      rescaleMax: props.rescaleMax ?? 0.3,
      dataTex: props.dataTex,
    };
  },
} as const satisfies ShaderModule<SampleAefRgbProps>;
