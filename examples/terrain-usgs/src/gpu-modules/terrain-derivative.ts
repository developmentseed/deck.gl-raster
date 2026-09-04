import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/** Props for the {@link TerrainDerivative} shader module. */
export type TerrainDerivativeProps = {
  /**
   * `r32float` elevation texture of size `(tileWidth + 2) × (tileHeight + 2)`:
   * the tile ringed by one texel of its neighbors' data.
   */
  elevationTexture: Texture;
  /** Logical tile size in texels, excluding the halo ring. */
  tileSize: [number, number];
  /**
   * Ground sample distance in the same linear units as the elevation values
   * (meters for the UTM-projected USGS products). Differs per overview level.
   */
  cellSize: number;
  /** Vertical exaggeration applied to the gradient. */
  zFactor: number;
  /** Sun direction in compass degrees, clockwise from north. */
  sunAzimuth: number;
  /** Sun height in degrees above the horizon. */
  sunAltitude: number;
  /** Nodata sentinel; fragments whose center sample matches are discarded. */
  nodata: number;
};

const MODULE_NAME = "terrainDerivative";

/**
 * The head module of the terrain render pipeline, and the only place the 3×3
 * kernel is written.
 *
 * Samples a 3×3 neighborhood from the halo texture with `texelFetch` and
 * applies Horn's method to derive slope, aspect, and a sun-shading factor.
 *
 * Two details make this correct:
 *
 * - **The halo inset.** The texture is two texels wider and taller than the
 *   logical tile, so the tile's own texel `(i, j)` lives at `(i + 1, j + 1)`.
 *   Without the ring, the `±1` taps at the tile border would clamp and halve
 *   the gradient, drawing a seam grid along every tile boundary.
 * - **`cellSize` is per-tile.** Slope is rise over *ground* distance, and a
 *   tile may come from any overview level (1 m through 32 m for these
 *   products). Because the gradient is computed in the source raster's own
 *   texel grid, it stays correct however the tile mesh is later reprojected
 *   for display — reprojection never enters the shading math.
 *
 * Pipeline contract, following the precedent of the land-cover example's
 * `CreateTextureUint`:
 * - Writes: `float elevation`, `float slopeDegrees`, `float shade`,
 *   `bool valid` (function-locals scoped to `DECKGL_FILTER_COLOR`)
 * - Reads: nothing
 * - Does **not** write `color` — a downstream module must.
 *
 * This replaces the library's `CreateTexture`, which samples
 * `texture(textureName, geometry.uv)` with no inset and so cannot address a
 * halo texture.
 */
export const TerrainDerivative = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  vec2 tileSize;
  float cellSize;
  float zFactor;
  float sunAzimuth;
  float sunAltitude;
  float nodata;
} ${MODULE_NAME};
`,
  inject: {
    "fs:#decl": /* glsl */ `
precision highp sampler2D;
uniform sampler2D elevationTexture;

/**
 * Read one texel of the halo texture at an offset from the tile texel
 * \`base\`, which is already expressed in halo coordinates.
 */
float ${MODULE_NAME}_sample(ivec2 base, int dx, int dy) {
  return texelFetch(elevationTexture, base + ivec2(dx, dy), 0).r;
}
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
  // The +1 shifts from logical tile coordinates into halo coordinates.
  ivec2 terrainTexel = ivec2(geometry.uv * ${MODULE_NAME}.tileSize) + ivec2(1);

  float elevation = ${MODULE_NAME}_sample(terrainTexel, 0, 0);
  bool valid = elevation != ${MODULE_NAME}.nodata && !isinf(elevation) && !isnan(elevation);

  // Horn's 3×3 window, laid out as ESRI documents it:
  //   a b c      (row -1 is north; texture rows increase southward)
  //   d e f
  //   g h i
  // A nodata neighbor is replaced by the center sample so it contributes no
  // gradient, rather than discarding the fragment outright — otherwise every
  // lidar void along a canyon rim would erode its surroundings by a texel.
  float hA = ${MODULE_NAME}_sample(terrainTexel, -1, -1);
  float hB = ${MODULE_NAME}_sample(terrainTexel,  0, -1);
  float hC = ${MODULE_NAME}_sample(terrainTexel,  1, -1);
  float hD = ${MODULE_NAME}_sample(terrainTexel, -1,  0);
  float hF = ${MODULE_NAME}_sample(terrainTexel,  1,  0);
  float hG = ${MODULE_NAME}_sample(terrainTexel, -1,  1);
  float hH = ${MODULE_NAME}_sample(terrainTexel,  0,  1);
  float hI = ${MODULE_NAME}_sample(terrainTexel,  1,  1);

  hA = (hA == ${MODULE_NAME}.nodata) ? elevation : hA;
  hB = (hB == ${MODULE_NAME}.nodata) ? elevation : hB;
  hC = (hC == ${MODULE_NAME}.nodata) ? elevation : hC;
  hD = (hD == ${MODULE_NAME}.nodata) ? elevation : hD;
  hF = (hF == ${MODULE_NAME}.nodata) ? elevation : hF;
  hG = (hG == ${MODULE_NAME}.nodata) ? elevation : hG;
  hH = (hH == ${MODULE_NAME}.nodata) ? elevation : hH;
  hI = (hI == ${MODULE_NAME}.nodata) ? elevation : hI;

  float denominator = 8.0 * ${MODULE_NAME}.cellSize;
  float dzdx = ((hC + 2.0 * hF + hI) - (hA + 2.0 * hD + hG)) / denominator;
  float dzdy = ((hG + 2.0 * hH + hI) - (hA + 2.0 * hB + hC)) / denominator;

  float rise = ${MODULE_NAME}.zFactor * sqrt(dzdx * dzdx + dzdy * dzdy);
  float slopeRadians = atan(rise);
  float slopeDegrees = degrees(slopeRadians);
  float aspectRadians = atan(dzdy, -dzdx);

  // Compass azimuth (clockwise from north) into the math convention the
  // aspect above is expressed in.
  float zenithRadians = radians(90.0 - ${MODULE_NAME}.sunAltitude);
  float azimuthRadians = radians(360.0 - ${MODULE_NAME}.sunAzimuth + 90.0);

  float shade = cos(zenithRadians) * cos(slopeRadians)
    + sin(zenithRadians) * sin(slopeRadians) * cos(azimuthRadians - aspectRadians);
  shade = clamp(shade, 0.0, 1.0);
`,
  },
  uniformTypes: {
    tileSize: "vec2<f32>",
    cellSize: "f32",
    zFactor: "f32",
    sunAzimuth: "f32",
    sunAltitude: "f32",
    nodata: "f32",
  },
  getUniforms: (props: Partial<TerrainDerivativeProps>) => {
    return {
      elevationTexture: props.elevationTexture,
      tileSize: props.tileSize ?? [256, 256],
      cellSize: props.cellSize ?? 1,
      zFactor: props.zFactor ?? 1,
      sunAzimuth: props.sunAzimuth ?? 315,
      sunAltitude: props.sunAltitude ?? 45,
      nodata: props.nodata ?? -3.4028235e38,
    };
  },
} as const satisfies ShaderModule<TerrainDerivativeProps>;
