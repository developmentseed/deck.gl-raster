/**
 * Simple pass-through module that sets geometry.uv to vTexCoord.
 * Used when no reprojection is needed.
 */
export const PassthroughUV = {
  name: "passthrough-uv",
  inject: {
    "fs:#main-start": /* glsl */ `
      geometry.uv = vTexCoord;
    `,
  },
  getUniforms: () => ({}),
} as const;
