import type { ShaderModule } from "@luma.gl/shadertools";

/** Earth equatorial radius used by Web Mercator (WGS84 / EPSG:3857). */
const EARTH_RADIUS = 6378137.0;

/** Web Mercator latitude limit in degrees. */
const MERCATOR_LAT_LIMIT = 85.051129;

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

function lngLatToMercatorMeters(lng: number, lat: number): [number, number] {
  const x = (EARTH_RADIUS * lng * Math.PI) / 180;
  const y =
    EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

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
 *
 * This module assumes the layer's mesh `positions` attribute is in EPSG:3857
 * meters — the convention used by `COGLayer` / `RasterLayer` in Web Mercator
 * rendering mode. It injects a vertex shader varying that passes each
 * vertex's 3857 meters through to the fragment shader, and compares against
 * a uniform bbox also in 3857 meters. This avoids deck.gl's common space and
 * its viewport-anchored precision translation, which would otherwise cause
 * the test to drift at higher zoom levels.
 */
export const CutlineBbox = {
  name: MODULE_NAME,
  fs: uniformBlock,
  inject: {
    // Declare the mercator-meters varying on both sides of the pipeline.
    "vs:#decl": `out vec2 v_cutlineBboxMercator;`,
    // `positions` is the per-vertex attribute the SimpleMeshLayer vertex
    // shader reads (see @deck.gl/mesh-layers simple-mesh-layer-vertex.glsl).
    // In COGLayer's CARTESIAN + web-mercator path this attribute is already
    // in EPSG:3857 meters. We capture it before any projection is applied.
    "vs:#main-start": /* glsl */ `
      v_cutlineBboxMercator = positions.xy;
    `,
    "fs:#decl": `in vec2 v_cutlineBboxMercator;`,
    // Injects at fs:#main-start (not fs:DECKGL_FILTER_COLOR). The
    // DECKGL_FILTER_COLOR hook is a generated function whose body is assembled
    // before the main FS source; top-level FS varyings declared in the main
    // source are out of scope there. Injecting at #main-start puts this test
    // inside main() where the varying is visible and discard still works.
    //
    // Globe support: when rendering in a GlobeView, the mesh positions are in
    // 4326 lng/lat rather than 3857 meters, so this exact varying is no
    // longer meaningful. A future globe code path would need a different
    // varying (e.g. lng/lat pair) and matching uniform layout.
    "fs:#main-start": /* glsl */ `
      {
        if (v_cutlineBboxMercator.x < ${MODULE_NAME}.bbox.x ||
            v_cutlineBboxMercator.x > ${MODULE_NAME}.bbox.z ||
            v_cutlineBboxMercator.y < ${MODULE_NAME}.bbox.y ||
            v_cutlineBboxMercator.y > ${MODULE_NAME}.bbox.w) {
          discard;
        }
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
    const [swX, swY] = lngLatToMercatorMeters(west, south);
    const [neX, neY] = lngLatToMercatorMeters(east, north);
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
