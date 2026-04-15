import type { ShaderModule } from "@luma.gl/shadertools";
import { lngLatToWorld } from "@math.gl/web-mercator";

export type CutlineBboxProps = {
  /**
   * WGS84 axis-aligned bbox as `[west, south, east, north]` in degrees.
   *
   * Must satisfy `east > west` (antimeridian crossing is not supported) and
   * `north > south`. Latitudes must lie within the Web Mercator limits
   * (±85.051129°).
   */
  bbox: [number, number, number, number];
};

const MODULE_NAME = "cutlineBbox";

const uniformBlock = `\
uniform ${MODULE_NAME}Uniforms {
  vec4 bbox;
} ${MODULE_NAME};
`;

/**
 * A shader module that discards fragments whose position falls outside a
 * WGS84 axis-aligned bbox.
 *
 * Intended for rendering rasters with a "map collar" (e.g. USGS historical
 * topographic maps) where the valid data area is described as a lat/lng bbox
 * but the raw pixels include surrounding metadata.
 *
 * Only supports rendering in a `WebMercatorViewport`. The caller is
 * responsible for enforcing this in application code; the module itself does
 * not have viewport access.
 */
export const CutlineBbox = {
  name: MODULE_NAME,
  fs: uniformBlock,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      // Globe support: when rendering in a GlobeView, position_commonspace is
      // on the unit sphere rather than in Web Mercator common space. A future
      // globe code path would need a different varying (e.g. lng/lat passed
      // through from the vertex shader) and a matching uniform layout.
      vec2 p = position_commonspace.xy;
      if (p.x < ${MODULE_NAME}.bbox.x || p.x > ${MODULE_NAME}.bbox.z ||
          p.y < ${MODULE_NAME}.bbox.y || p.y > ${MODULE_NAME}.bbox.w) {
        discard;
      }
    `,
  },
  uniformTypes: {
    bbox: "vec4<f32>",
  },
  getUniforms: (props: Partial<CutlineBboxProps>) => {
    const bbox = props.bbox;
    if (!bbox) {
      return {};
    }
    const [west, south, east, north] = bbox;
    if (!(east > west)) {
      throw new Error(
        `CutlineBbox: bbox must have east > west (antimeridian crossing is not supported); got west=${west}, east=${east}`,
      );
    }
    if (!(north > south)) {
      throw new Error(
        `CutlineBbox: bbox must have north > south; got south=${south}, north=${north}`,
      );
    }
    const MERCATOR_LAT_LIMIT = 85.051129;
    if (
      south < -MERCATOR_LAT_LIMIT ||
      south > MERCATOR_LAT_LIMIT ||
      north < -MERCATOR_LAT_LIMIT ||
      north > MERCATOR_LAT_LIMIT
    ) {
      throw new Error(
        `CutlineBbox: bbox latitudes must be within Web Mercator limits (±${MERCATOR_LAT_LIMIT}°); got south=${south}, north=${north}`,
      );
    }
    const [swX, swY] = lngLatToWorld([west, south]);
    const [neX, neY] = lngLatToWorld([east, north]);
    return {
      bbox: [
        Math.min(swX, neX),
        Math.min(swY, neY),
        Math.max(swX, neX),
        Math.max(swY, neY),
      ],
    };
  },
} as const satisfies ShaderModule<CutlineBboxProps>;
