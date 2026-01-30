/**
 * Reprojection Module for EPSG:4326 Source Data
 *
 * This shader module performs Mercator → Latitude inversion in the fragment shader
 * to correctly sample EPSG:4326 (WGS84) textures when rendering on a Web Mercator map.
 *
 * The mesh is positioned in WGS84 coordinates (deck.gl's native coordinate system),
 * but the texture needs non-linear UV mapping because:
 * - The texture is in lat/lon (linear geographic coordinates)
 * - The mesh vertices are projected to Web Mercator for display
 * - UV interpolation across the mesh is linear, but the Mercator projection is non-linear
 *
 * This module inverts the Mercator Y → latitude before texture lookup.
 */
import type { ShaderModule } from "@luma.gl/shadertools";

export type Reproject4326Props = {
  /** Latitude bounds [min, max] in degrees */
  latBounds: [number, number];
  /** Mercator Y bounds [north, south] in normalized [0,1] coordinates */
  mercatorYBounds: [number, number];
  /** Whether row 0 of the texture is south (true) or north (false) */
  latIsAscending: boolean;
};

const PI = Math.PI;

/**
 * Convert latitude to normalized Mercator Y [0, 1].
 * Y=0 is north (+85.05°), Y=1 is south (-85.05°)
 */
export function latToMercatorNorm(lat: number): number {
  const MERCATOR_LAT_LIMIT = 85.05112878;
  const clamped = Math.max(-MERCATOR_LAT_LIMIT, Math.min(MERCATOR_LAT_LIMIT, lat));
  return (
    (1 -
      Math.log(
        Math.tan((clamped * PI) / 180) +
          1 / Math.cos((clamped * PI) / 180)
      ) /
        PI) /
    2
  );
}

/**
 * Compute the reprojection props from latitude bounds and data orientation.
 */
export function computeReproject4326Props(
  latMin: number,
  latMax: number,
  latIsAscending: boolean,
): Reproject4326Props {
  // Compute Mercator Y bounds from latitude
  // mercatorYBounds[0] = north (smaller Y value), mercatorYBounds[1] = south (larger Y value)
  const mercYNorth = latToMercatorNorm(latMax);
  const mercYSouth = latToMercatorNorm(latMin);

  return {
    latBounds: [latMin, latMax],
    mercatorYBounds: [mercYNorth, mercYSouth],
    latIsAscending,
  };
}

/**
 * Reprojection shader module for EPSG:4326 source data.
 *
 * This module modifies geometry.uv before texture sampling to account for
 * the non-linear relationship between Mercator Y and latitude.
 *
 * IMPORTANT: This module must be added to the render pipeline BEFORE the
 * texture sampling module (e.g., CreateTexture).
 */
export const Reproject4326 = {
  name: "reproject-4326",
  inject: {
    "fs:#decl": /* glsl */ `
      const float PI_REPROJECT_4326 = 3.14159265358979323846;

      // Uniforms for EPSG:4326 reprojection
      uniform vec2 reproject4326_latBounds;      // [latMin, latMax] in degrees
      uniform vec2 reproject4326_mercatorYBounds; // [mercY_north, mercY_south] in [0,1]
      uniform int reproject4326_latIsAscending;  // 1 = row 0 is south, 0 = row 0 is north

      // Invert Mercator Y to latitude in degrees
      float mercatorYToLat(float mercY) {
        // mercY is normalized [0,1] where 0=north, 1=south
        // Convert to Mercator radians: mercY=0 -> PI (north), mercY=1 -> -PI (south)
        float t = PI_REPROJECT_4326 * (1.0 - 2.0 * mercY);
        return degrees(atan(sinh(t)));
      }

      // Compute reprojected texture V coordinate
      float computeReprojectTexV(float mercY) {
        // Get latitude from Mercator Y
        float lat = mercatorYToLat(mercY);

        // Map latitude to texture V coordinate based on data orientation
        float latRange = reproject4326_latBounds.y - reproject4326_latBounds.x;
        float texV;

        if (reproject4326_latIsAscending == 1) {
          // Row 0 = south (latMin), row N = north (latMax)
          texV = (lat - reproject4326_latBounds.x) / latRange;
        } else {
          // Row 0 = north (latMax), row N = south (latMin)
          texV = (reproject4326_latBounds.y - lat) / latRange;
        }

        return texV;
      }
    `,
    // Inject BEFORE DECKGL_FILTER_COLOR to modify geometry.uv before texture sampling
    // Using the fs:#main-start hook which runs at the beginning of main()
    "fs:#main-start": /* glsl */ `
      // Only apply reprojection if mercatorYBounds are set (non-zero range)
      float mercRange = reproject4326_mercatorYBounds.y - reproject4326_mercatorYBounds.x;
      if (abs(mercRange) > 0.0001) {
        // Compute current Mercator Y from UV
        // vTexCoord.y maps linearly across the mesh, which is positioned in Mercator space
        // We need to interpolate between the north and south Mercator Y bounds
        float currentMercY = mix(
          reproject4326_mercatorYBounds.x,
          reproject4326_mercatorYBounds.y,
          vTexCoord.y
        );

        // Compute reprojected texture V
        float reprojectTexV = computeReprojectTexV(currentMercY);

        // Store original UV for later restoration if needed
        // Override geometry.uv with reprojected coordinates
        geometry.uv = vec2(vTexCoord.x, reprojectTexV);
      }
    `,
  },
  getUniforms: (props: Partial<Reproject4326Props> = {}) => {
    const latBounds = props.latBounds ?? [0, 0];
    const mercatorYBounds = props.mercatorYBounds ?? [0, 0];
    const latIsAscending = props.latIsAscending ?? false;

    return {
      reproject4326_latBounds: latBounds,
      reproject4326_mercatorYBounds: mercatorYBounds,
      reproject4326_latIsAscending: latIsAscending ? 1 : 0,
    };
  },
} as const satisfies ShaderModule<Reproject4326Props>;
