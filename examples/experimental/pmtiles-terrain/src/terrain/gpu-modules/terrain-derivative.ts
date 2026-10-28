import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/** Props for the {@link TerrainDerivative} shader module. */
export type TerrainDerivativeProps = {
  /**
   * `r32float` elevation texture of size `(tileWidth + 2) x (tileHeight + 2)`:
   * the tile ringed by one texel of its neighbors' data.
   */
  elevationTexture: Texture;
  /** Logical tile size in texels, excluding the halo ring. */
  tileSize: [number, number];
  /**
   * Width of a texel on the Web Mercator plane, in meters. The shader turns
   * it into a ground distance per fragment, from the fragment's latitude.
   */
  cellSize: number;
  /** Web Mercator y of the tile's north and south edges, in meters. */
  mercatorYRange: [north: number, south: number];
  /** Vertical exaggeration applied to the gradient. */
  zFactor: number;
  /** Sun direction in compass degrees, clockwise from north. */
  sunAzimuth: number;
  /** Sun height in degrees above the horizon. */
  sunAltitude: number;
};

/**
 * The module's uniforms. They differ from its props: `mercatorYRange` becomes
 * two floats.
 */
type TerrainDerivativeUniforms = {
  tileSize: [number, number];
  cellSize: number;
  mercatorYNorth: number;
  mercatorYSouth: number;
  zFactor: number;
  sunAzimuth: number;
  sunAltitude: number;
};

/** The module's texture binding. */
type TerrainDerivativeBindings = {
  elevationTexture: Texture;
};

const MODULE_NAME = "terrainDerivative";

/**
 * The head module of the terrain render pipeline, and the only place the 3 x 3
 * kernel is written.
 *
 * Samples a 3 x 3 neighborhood from the halo texture with `texelFetch` and
 * applies Horn's method to derive slope, aspect, and a sun-shading factor.
 *
 * Two details make this correct:
 *
 * - **The halo inset.** The texture is two texels wider and taller than the
 *   logical tile, so the tile's own texel `(i, j)` lives at `(i + 1, j + 1)`.
 *   Without the ring, the `+/-1` taps at the tile border would clamp and
 *   halve the gradient, drawing a seam along every tile boundary.
 * - **The ground cell size follows latitude.** Slope is rise over *ground*
 *   distance. A Web Mercator texel is `cellSize` meters wide on the plane but
 *   `cellSize * cos(latitude)` on the ground, the same in x and y because
 *   Mercator is conformal. One value per tile would jump between rows of
 *   tiles (7% between z6 rows near 46°N), so each fragment computes its own
 *   from its Mercator y, which is linear across the tile.
 *
 * Pipeline contract:
 * - Writes: `float elevation`, `float slopeDegrees`, `float shade`,
 *   `bool valid` (function-locals scoped to `DECKGL_FILTER_COLOR`)
 * - Reads: nothing
 * - Does **not** write `color`: a downstream module must.
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
  float mercatorYNorth;
  float mercatorYSouth;
  float zFactor;
  float sunAzimuth;
  float sunAltitude;
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
  // Terrarium has no nodata value; this only guards against a broken texel.
  bool valid = !isinf(elevation) && !isnan(elevation);

  // Horn's 3 x 3 window, laid out as ESRI documents it:
  //   a b c      (row -1 is north; texture rows increase southward)
  //   d e f
  //   g h i
  float hA = ${MODULE_NAME}_sample(terrainTexel, -1, -1);
  float hB = ${MODULE_NAME}_sample(terrainTexel,  0, -1);
  float hC = ${MODULE_NAME}_sample(terrainTexel,  1, -1);
  float hD = ${MODULE_NAME}_sample(terrainTexel, -1,  0);
  float hF = ${MODULE_NAME}_sample(terrainTexel,  1,  0);
  float hG = ${MODULE_NAME}_sample(terrainTexel, -1,  1);
  float hH = ${MODULE_NAME}_sample(terrainTexel,  0,  1);
  float hI = ${MODULE_NAME}_sample(terrainTexel,  1,  1);

  // geometry.uv.y is 0 at the tile's north edge, where the first texture row
  // is. The tile is linear in Mercator y, so interpolating it is exact.
  float mercatorY = mix(
    ${MODULE_NAME}.mercatorYNorth,
    ${MODULE_NAME}.mercatorYSouth,
    geometry.uv.y
  );
  float latitude = 2.0 * atan(exp(mercatorY / 6378137.0)) - radians(90.0);
  float groundCellSize = ${MODULE_NAME}.cellSize * cos(latitude);

  float denominator = 8.0 * groundCellSize;
  float dzdx = ((hC + 2.0 * hF + hI) - (hA + 2.0 * hD + hG)) / denominator;
  float dzdy = ((hG + 2.0 * hH + hI) - (hA + 2.0 * hB + hC)) / denominator;

  float rise = ${MODULE_NAME}.zFactor * sqrt(dzdx * dzdx + dzdy * dzdy);
  float slopeRadians = atan(rise);
  float slopeDegrees = degrees(slopeRadians);
  // atan(0, 0) is undefined in GLSL. On flat ground, such as a lake, the
  // aspect doesn't matter, since sin(slope) is 0, but an undefined value can
  // still turn the shade into NaN and draw the lake black.
  float aspectRadians = (dzdx == 0.0 && dzdy == 0.0) ? 0.0 : atan(dzdy, -dzdx);

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
    mercatorYNorth: "f32",
    mercatorYSouth: "f32",
    zFactor: "f32",
    sunAzimuth: "f32",
    sunAltitude: "f32",
  },
  getUniforms: (props: Partial<TerrainDerivativeProps>) => {
    return {
      elevationTexture: props.elevationTexture,
      tileSize: props.tileSize ?? [512, 512],
      cellSize: props.cellSize ?? 1,
      mercatorYNorth: props.mercatorYRange?.[0] ?? 0,
      mercatorYSouth: props.mercatorYRange?.[1] ?? 0,
      zFactor: props.zFactor ?? 1,
      sunAzimuth: props.sunAzimuth ?? 315,
      sunAltitude: props.sunAltitude ?? 45,
    };
  },
} as const satisfies ShaderModule<
  TerrainDerivativeProps,
  TerrainDerivativeUniforms,
  TerrainDerivativeBindings
>;
