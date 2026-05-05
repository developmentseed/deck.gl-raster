import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/** Props for the {@link FilterCategory} shader module. */
export type FilterCategoryProps = {
  /**
   * 256×1 `r8unorm` lookup texture: byte 255 at the index of every selected
   * category code, 0 elsewhere. Sampled with `texelFetch`, so the sampler
   * filter does not affect lookup correctness.
   */
  categoryFilterLUT: Texture;
};

/**
 * Discards fragments whose integer category code (read from `icolor.r`)
 * is not selected in `categoryFilterLUT`.
 *
 * Pipeline contract:
 * - Reads: `ivec4 icolor` (introduced by an upstream module such as
 *   `CreateTextureUint`)
 * - Writes: nothing
 *
 * Must come after a module that introduces `ivec4 icolor`. If no
 * upstream module introduces it, the GLSL compiler reports `icolor` as
 * undeclared.
 */
export const FilterCategory = {
  name: "filter-category",
  inject: {
    "fs:#decl": `uniform sampler2D categoryFilterLUT;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      if (texelFetch(categoryFilterLUT, ivec2(icolor.r, 0), 0).r < 0.5) {
        discard;
      }
    `,
  },
  getUniforms: (props: Partial<FilterCategoryProps>) => {
    return {
      categoryFilterLUT: props.categoryFilterLUT,
    };
  },
} as const satisfies ShaderModule<FilterCategoryProps>;
