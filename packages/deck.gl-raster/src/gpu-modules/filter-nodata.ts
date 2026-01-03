import type { ShaderModule } from "@luma.gl/shadertools";

export type FilterNoDataValProps = {
  value: number;
};

/** This module name must be consistent */
const MODULE_NAME = "nodata";

const uniformBlock = `\
uniform ${MODULE_NAME}Uniforms {
  float value;
} ${MODULE_NAME};
`;

/**
 * A shader module that filters out (discards) pixels whose value matches the
 * provided nodata value.
 */
export const FilterNoDataVal = {
  name: MODULE_NAME,
  fs: uniformBlock,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
    if (color.r == nodata.value) {
      discard;
    }
    `,
  },
  uniformTypes: {
    value: "f32",
  },
  getUniforms: (props: Partial<FilterNoDataValProps>) => {
    return {
      value: props.value,
    };
  },
} as const satisfies ShaderModule<FilterNoDataValProps>;
