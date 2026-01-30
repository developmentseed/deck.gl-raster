/**
 * Combined Reprojection + Texture Sampling Module for EPSG:4326 Source Data
 *
 * This module combines UV reprojection and texture sampling into a single
 * DECKGL_FILTER_COLOR hook to avoid issues with geometry.uv not persisting
 * between shader module injections.
 */
import type { Texture } from "@luma.gl/core";

export type ReprojectTextureProps = {
  /** The texture to sample */
  textureName: Texture;
  /** Latitude bounds [south, north] in degrees */
  latBounds: [number, number];
  /** Mercator Y bounds [north, south] in normalized coordinates */
  mercatorYBounds: [number, number];
  /** Whether row 0 of the texture is south (true) or north (false) */
  latIsAscending: boolean;
  /** Debug mode: 0=off, 1=show texV as grayscale, 2=show original vTexCoord.y */
  debugMode?: number;
};

/** Module name - must match uniform block name */
const MODULE_NAME = "reprojectTexture";

/** Uniform block for non-texture uniforms (luma.gl v9 pattern) */
const uniformBlock = /* glsl */ `\
uniform ${MODULE_NAME}Uniforms {
  vec2 latBounds;
  vec2 mercatorYBounds;
  int latIsAscending;
  int debugMode;
} ${MODULE_NAME};
`;

export const ReprojectTexture = {
  name: MODULE_NAME,
  fs: uniformBlock,
  inject: {
    "fs:#decl": /* glsl */ `
      const float PI_REPROJ = 3.14159265358979323846;

      uniform sampler2D reprojectTexture_texture;

      // Convert normalized Mercator Y [0,1] to latitude in degrees
      float mercatorYToLat_reproj(float mercY) {
        float t = PI_REPROJ * (1.0 - 2.0 * mercY);
        return degrees(atan(sinh(t)));
      }
    `,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      // Check if uniforms are set (mercatorYBounds will be [0,0] if not)
      // If not set, discard fragment to avoid flash during loading
      if (reprojectTexture.mercatorYBounds.x == 0.0 && reprojectTexture.mercatorYBounds.y == 0.0) {
        discard;
      }

      // Get the original UV from geometry.uv (set to vTexCoord by base shader or passthrough)
      vec2 originalUV = geometry.uv;

      // Interpolate Mercator Y based on original UV.y
      float currentMercY;
      if (reprojectTexture.latIsAscending == 1) {
        // UV.y: 0 at south, 1 at north
        currentMercY = mix(
          reprojectTexture.mercatorYBounds.y,  // south (at y=0)
          reprojectTexture.mercatorYBounds.x,  // north (at y=1)
          originalUV.y
        );
      } else {
        // UV.y: 0 at north, 1 at south
        currentMercY = mix(
          reprojectTexture.mercatorYBounds.x,  // north (at y=0)
          reprojectTexture.mercatorYBounds.y,  // south (at y=1)
          originalUV.y
        );
      }

      // Convert Mercator Y to latitude
      float lat = mercatorYToLat_reproj(currentMercY);

      // Map latitude to texture V
      float south = reprojectTexture.latBounds.x;
      float north = reprojectTexture.latBounds.y;
      float latRange = north - south;

      float texV;
      if (reprojectTexture.latIsAscending == 1) {
        texV = (lat - south) / latRange;
      } else {
        texV = (north - lat) / latRange;
      }

      // Sample texture with reprojected UV
      vec2 reprojectedUV = vec2(originalUV.x, texV);
      color = texture(reprojectTexture_texture, reprojectedUV);

      // Debug modes
      if (reprojectTexture.debugMode == 1) {
        color = vec4(texV, texV, texV, 1.0);
      }
      if (reprojectTexture.debugMode == 2) {
        color = vec4(originalUV.y, originalUV.y, originalUV.y, 1.0);
      }
    `,
  },
  // Uniform types for luma.gl v9 (must match uniform block order)
  uniformTypes: {
    latBounds: "vec2<f32>",
    mercatorYBounds: "vec2<f32>",
    latIsAscending: "i32",
    debugMode: "i32",
  },
  getUniforms: (props: Partial<ReprojectTextureProps> = {}) => {
    return {
      // Texture is handled separately via setBindings
      reprojectTexture_texture: props.textureName,
      // Non-texture uniforms go to uniform block
      latBounds: props.latBounds ?? [0, 0],
      mercatorYBounds: props.mercatorYBounds ?? [0, 0],
      latIsAscending: props.latIsAscending ? 1 : 0,
      debugMode: props.debugMode ?? 0,
    };
  },
} as const;
