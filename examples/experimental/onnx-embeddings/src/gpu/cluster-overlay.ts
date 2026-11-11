import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Categorical colors for up to 12 clusters: ColorBrewer "Paired", with the
 * six saturated colors first.
 */
export const CLUSTER_COLORS: readonly (readonly [number, number, number])[] = [
  [31, 120, 180],
  [51, 160, 44],
  [227, 26, 28],
  [255, 127, 0],
  [106, 61, 154],
  [177, 89, 40],
  [166, 206, 227],
  [178, 223, 138],
  [251, 154, 153],
  [253, 191, 111],
  [202, 178, 214],
  [255, 255, 153],
];

/** Largest number of clusters {@link ClusterOverlay} has colors for. */
export const MAX_CLUSTERS = CLUSTER_COLORS.length;

/**
 * Props for the {@link ClusterOverlay} shader module.
 */
export type ClusterOverlayProps = {
  /** r32float texture with one cluster index per pixel. */
  clusterTex: Texture;
  /** Opacity of the cluster colors, 0 to 1. */
  opacity: number;
  /** Brightness of the color already there, or 0 to draw over nothing. */
  backdrop: number;
};

const MODULE_NAME = "clusterOverlay";

const PALETTE_GLSL = CLUSTER_COLORS.map(
  ([r, g, b]) =>
    `vec3(${(r / 255).toFixed(4)}, ${(g / 255).toFixed(4)}, ${(b / 255).toFixed(4)})`,
).join(",\n  ");

/**
 * A shader module that draws the color of each pixel's cluster index, at
 * `opacity`. With `backdrop` above 0, the color already there is dimmed to
 * that brightness and stays underneath.
 */
export const ClusterOverlay = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  float opacity;
  float backdrop;
} ${MODULE_NAME};
`,
  inject: {
    "fs:#decl": `
uniform sampler2D clusterTex;
const vec3 CLUSTER_PALETTE[${MAX_CLUSTERS}] = vec3[${MAX_CLUSTERS}](
  ${PALETTE_GLSL}
);
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      int clusterOverlay_index = clamp(
        int(texture(clusterTex, geometry.uv).r + 0.5),
        0,
        ${MAX_CLUSTERS - 1}
      );
      color = ${MODULE_NAME}.backdrop > 0.0
        ? vec4(
            mix(
              color.rgb * ${MODULE_NAME}.backdrop,
              CLUSTER_PALETTE[clusterOverlay_index],
              ${MODULE_NAME}.opacity
            ),
            1.0
          )
        : vec4(CLUSTER_PALETTE[clusterOverlay_index], ${MODULE_NAME}.opacity);
    `,
  },
  uniformTypes: {
    opacity: "f32",
    backdrop: "f32",
  },
  getUniforms: (props: Partial<ClusterOverlayProps>) => {
    return {
      opacity: props.opacity ?? 0.8,
      backdrop: props.backdrop ?? 0,
      clusterTex: props.clusterTex,
    };
  },
} as const satisfies ShaderModule<ClusterOverlayProps>;
