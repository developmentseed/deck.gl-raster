import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Maximum number of band texture slots supported by {@link CompositeBands}.
 */
export const MAX_BAND_SLOTS = 4;

/**
 * Props for the {@link CompositeBands} shader module.
 *
 * Textures (`band0`–`band3`) are bound via `getUniforms`. Scalar uniforms
 * (`uvTransform0`–`uvTransform3`, `channelMap`) go through a uniform block.
 */
export type CompositeBandsProps = {
  band0: Texture;
  band1: Texture;
  band2: Texture;
  band3: Texture;
  uvTransform0: [number, number, number, number];
  uvTransform1: [number, number, number, number];
  uvTransform2: [number, number, number, number];
  uvTransform3: [number, number, number, number];
  channelMap: [number, number, number, number];
};

const MODULE_NAME = "compositeBands";

/**
 * A shader module that samples up to 4 band textures with per-band UV
 * transforms and composites them into a `vec4` color.
 *
 * Uses fixed uniform slots (`band0`–`band3`) for textures (bound via
 * `getUniforms`) and a uniform block for scalar values (`uvTransform0`–
 * `uvTransform3`, `channelMap`).
 *
 * @see {@link CompositeBandsProps}
 * @see {@link buildCompositeBandsProps} for a helper that maps named bands
 *   to slot indices.
 */
export const CompositeBands = {
  name: MODULE_NAME,
  // Texture samplers — declared via inject, bound via getUniforms
  inject: {
    "fs:#decl": /* glsl */ `
uniform sampler2D band0;
uniform sampler2D band1;
uniform sampler2D band2;
uniform sampler2D band3;

vec2 compositeBands_applyUv(vec2 uv, vec4 transform) {
  return uv * transform.zw + transform.xy;
}

float compositeBands_sampleSlot(int slot, vec2 uv) {
  if (slot == 0) return texture(band0, compositeBands_applyUv(uv, ${MODULE_NAME}.uvTransform0)).r;
  if (slot == 1) return texture(band1, compositeBands_applyUv(uv, ${MODULE_NAME}.uvTransform1)).r;
  if (slot == 2) return texture(band2, compositeBands_applyUv(uv, ${MODULE_NAME}.uvTransform2)).r;
  if (slot == 3) return texture(band3, compositeBands_applyUv(uv, ${MODULE_NAME}.uvTransform3)).r;
  return 0.0;
}
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
  float r = ${MODULE_NAME}.channelMap.r >= 0 ? compositeBands_sampleSlot(${MODULE_NAME}.channelMap.r, geometry.uv) : 0.0;
  float g = ${MODULE_NAME}.channelMap.g >= 0 ? compositeBands_sampleSlot(${MODULE_NAME}.channelMap.g, geometry.uv) : 0.0;
  float b = ${MODULE_NAME}.channelMap.b >= 0 ? compositeBands_sampleSlot(${MODULE_NAME}.channelMap.b, geometry.uv) : 0.0;
  float a = ${MODULE_NAME}.channelMap.a >= 0 ? compositeBands_sampleSlot(${MODULE_NAME}.channelMap.a, geometry.uv) : 1.0;
  color = vec4(r, g, b, a);
`,
  },
  // Scalar uniforms — declared via fs uniform block + uniformTypes
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  vec4 uvTransform0;
  vec4 uvTransform1;
  vec4 uvTransform2;
  vec4 uvTransform3;
  ivec4 channelMap;
} ${MODULE_NAME};
`,
  uniformTypes: {
    uvTransform0: "vec4<f32>",
    uvTransform1: "vec4<f32>",
    uvTransform2: "vec4<f32>",
    uvTransform3: "vec4<f32>",
    channelMap: "vec4<i32>",
  },
  getUniforms: (props: Partial<CompositeBandsProps>) => {
    return {
      // Texture bindings
      band0: props.band0,
      band1: props.band1,
      band2: props.band2,
      band3: props.band3,
      // Scalar uniforms (uniform block)
      uvTransform0: props.uvTransform0 ?? [0, 0, 1, 1],
      uvTransform1: props.uvTransform1 ?? [0, 0, 1, 1],
      uvTransform2: props.uvTransform2 ?? [0, 0, 1, 1],
      uvTransform3: props.uvTransform3 ?? [0, 0, 1, 1],
      channelMap: props.channelMap ?? [0, 1, 2, -1],
    };
  },
} as const satisfies ShaderModule<CompositeBandsProps>;

/**
 * Maps named bands and their UV transforms to {@link CompositeBandsProps}
 * slot indices.
 *
 * Assigns each unique band name to a fixed slot (0–3), builds the
 * `channelMap` that maps RGBA output channels to slots, and fills unused
 * slots with a placeholder texture to satisfy WebGL binding requirements.
 *
 * @param mapping - Which named band goes to which RGBA channel.
 * @param bands - Map of band name to texture + UV transform.
 * @returns Props ready to pass to `{ module: CompositeBands, props: ... }`.
 *
 * @see {@link CompositeBands}
 */
export function buildCompositeBandsProps(
  mapping: { r: string; g?: string; b?: string; a?: string },
  bands: Map<
    string,
    {
      texture: Texture;
      uvTransform: {
        offsetX: number;
        offsetY: number;
        scaleX: number;
        scaleY: number;
      };
    }
  >,
): Partial<CompositeBandsProps> {
  // Collect unique band names in mapping order and assign slot indices
  const slotNames: string[] = [];
  const slotIndex = new Map<string, number>();

  for (const name of [mapping.r, mapping.g, mapping.b, mapping.a]) {
    if (name && !slotIndex.has(name)) {
      if (slotNames.length >= MAX_BAND_SLOTS) {
        throw new Error(
          `CompositeBands supports at most ${MAX_BAND_SLOTS} band slots`,
        );
      }
      slotIndex.set(name, slotNames.length);
      slotNames.push(name);
    }
  }

  function slotFor(name: string | undefined): number {
    return name ? (slotIndex.get(name) ?? -1) : -1;
  }

  const props: Record<string, unknown> = {
    channelMap: [
      slotFor(mapping.r),
      slotFor(mapping.g),
      slotFor(mapping.b),
      slotFor(mapping.a),
    ],
  };

  // Get the first texture to use as a placeholder for unused slots.
  // WebGL requires all declared samplers to have a valid texture bound,
  // even if the channelMap never references them.
  const firstBandName = slotNames[0];
  if (!firstBandName) {
    throw new Error("At least one band is required");
  }
  const firstTexture = bands.get(firstBandName)!.texture;

  for (const [name, slot] of slotIndex) {
    const band = bands.get(name);
    if (!band) {
      throw new Error(`Band "${name}" not found in fetched bands`);
    }
    const uv = band.uvTransform;
    props[`band${slot}`] = band.texture;
    props[`uvTransform${slot}`] = [
      uv.offsetX,
      uv.offsetY,
      uv.scaleX,
      uv.scaleY,
    ];
  }

  // Fill unused slots with the first texture as a placeholder
  for (let i = slotNames.length; i < MAX_BAND_SLOTS; i++) {
    props[`band${i}`] = firstTexture;
  }

  return props as Partial<CompositeBandsProps>;
}
