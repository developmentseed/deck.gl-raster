import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import { CreateTexture } from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

export type HillshadeTileData = {
  texture: Texture;
  width: number;
  height: number;
  byteLength: number;
};

export type SwissHillshadeProps = {
  demTexture: Texture;
  textureSize: readonly [number, number];
  pixelSizeMeters: number;
  azimuth: number;
  altitude: number;
  zFactor: number;
  elevationMin: number;
  elevationMax: number;
  tintStrength: number;
  shadowStrength: number;
  contourStrength: number;
};

export type DemColorProps = {
  elevationMin: number;
  elevationMax: number;
};

const HILLSHADE_MODULE_NAME = "swissHillshade";
const DEM_COLOR_MODULE_NAME = "demElevationColor";

export const SwissHillshade = {
  name: HILLSHADE_MODULE_NAME,
  fs: `\
uniform ${HILLSHADE_MODULE_NAME}Uniforms {
  vec2 textureSize;
  float pixelSizeMeters;
  float azimuth;
  float altitude;
  float zFactor;
  float elevationMin;
  float elevationMax;
  float tintStrength;
  float shadowStrength;
  float contourStrength;
} ${HILLSHADE_MODULE_NAME};
`,
  inject: {
    "fs:#decl": /* glsl */ `
uniform highp sampler2D demTexture;

float relief_fetchDem(vec2 uv, float fallback) {
  float v = texture(demTexture, clamp(uv, vec2(0.001), vec2(0.999))).r;
  return v < -9000.0 ? fallback : v;
}

vec3 relief_palette(float elevation, float shade, float slope) {
  float t = clamp(
    (elevation - ${HILLSHADE_MODULE_NAME}.elevationMin) /
    max(${HILLSHADE_MODULE_NAME}.elevationMax - ${HILLSHADE_MODULE_NAME}.elevationMin, 1.0),
    0.0,
    1.0
  );

  vec3 valley = vec3(0.72, 0.67, 0.52);
  vec3 pasture = vec3(0.58, 0.64, 0.49);
  vec3 rock = vec3(0.61, 0.56, 0.49);
  vec3 snow = vec3(0.95, 0.92, 0.84);
  vec3 tint = mix(valley, pasture, smoothstep(0.04, 0.36, t));
  tint = mix(tint, rock, smoothstep(0.34, 0.74, t));
  tint = mix(tint, snow, smoothstep(0.78, 0.96, t));

  vec3 coolShadow = vec3(0.28, 0.34, 0.46);
  vec3 warmLight = vec3(1.0, 0.86, 0.61);
  vec3 paper = vec3(0.86, 0.83, 0.73);
  vec3 relief = mix(coolShadow, paper, smoothstep(0.08, 0.68, shade));
  relief = mix(relief, warmLight, smoothstep(0.62, 1.0, shade) * 0.42);

  float ridgeInk = smoothstep(0.28, 0.88, slope) * (1.0 - shade) * 0.24;
  vec3 color = mix(relief, tint, ${HILLSHADE_MODULE_NAME}.tintStrength);
  color = mix(color, color * vec3(0.70, 0.76, 0.88), ridgeInk);
  return color;
}
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      vec2 texel = 1.0 / ${HILLSHADE_MODULE_NAME}.textureSize;
      float center = color.r;
      if (center < -9000.0) {
        discard;
      }

      float west = relief_fetchDem(geometry.uv + vec2(-texel.x, 0.0), center);
      float east = relief_fetchDem(geometry.uv + vec2(texel.x, 0.0), center);
      float north = relief_fetchDem(geometry.uv + vec2(0.0, -texel.y), center);
      float south = relief_fetchDem(geometry.uv + vec2(0.0, texel.y), center);
      float nw = relief_fetchDem(geometry.uv + vec2(-texel.x, -texel.y), center);
      float se = relief_fetchDem(geometry.uv + vec2(texel.x, texel.y), center);

      float dzdx = ((east - west) / (2.0 * ${HILLSHADE_MODULE_NAME}.pixelSizeMeters)) * ${HILLSHADE_MODULE_NAME}.zFactor;
      float dzdy = ((north - south) / (2.0 * ${HILLSHADE_MODULE_NAME}.pixelSizeMeters)) * ${HILLSHADE_MODULE_NAME}.zFactor;
      vec3 normal = normalize(vec3(-dzdx, -dzdy, 1.0));

      float az = radians(${HILLSHADE_MODULE_NAME}.azimuth);
      float alt = radians(${HILLSHADE_MODULE_NAME}.altitude);
      vec3 keyLight = normalize(vec3(sin(az) * cos(alt), cos(az) * cos(alt), sin(alt)));
      vec3 fillLight = normalize(vec3(sin(az + radians(115.0)) * 0.45, cos(az + radians(115.0)) * 0.45, 0.84));

      float key = clamp(dot(normal, keyLight), 0.0, 1.0);
      float fill = clamp(dot(normal, fillLight), 0.0, 1.0);
      float slope = clamp(length(vec2(dzdx, dzdy)), 0.0, 1.0);
      float shade = clamp(0.30 + 0.74 * key + 0.18 * fill - slope * ${HILLSHADE_MODULE_NAME}.shadowStrength * 0.34, 0.0, 1.0);

      float diagonalBreak = abs((center - nw) - (se - center));
      float contour = smoothstep(0.0, 1.0, abs(fract(center / 40.0) - 0.5) * 2.0);
      float ink = (1.0 - contour) * ${HILLSHADE_MODULE_NAME}.contourStrength * 0.10 + smoothstep(2.0, 26.0, diagonalBreak) * 0.05;

      vec3 outColor = relief_palette(center, shade, slope);
      outColor *= mix(0.78, 1.12, shade);
      outColor = mix(outColor, outColor * vec3(0.62, 0.68, 0.82), ink);
      color = vec4(pow(clamp(outColor, 0.0, 1.0), vec3(0.92)), 1.0);
    `,
  },
  uniformTypes: {
    textureSize: "vec2<f32>",
    pixelSizeMeters: "f32",
    azimuth: "f32",
    altitude: "f32",
    zFactor: "f32",
    elevationMin: "f32",
    elevationMax: "f32",
    tintStrength: "f32",
    shadowStrength: "f32",
    contourStrength: "f32",
  },
  getUniforms: (props: Partial<SwissHillshadeProps>) => {
    return {
      demTexture: props.demTexture,
      textureSize: props.textureSize ?? [1, 1],
      pixelSizeMeters: props.pixelSizeMeters ?? 2,
      azimuth: props.azimuth ?? 315,
      altitude: props.altitude ?? 42,
      zFactor: props.zFactor ?? 1.4,
      elevationMin: props.elevationMin ?? 2800,
      elevationMax: props.elevationMax ?? 4500,
      tintStrength: props.tintStrength ?? 0.48,
      shadowStrength: props.shadowStrength ?? 0.72,
      contourStrength: props.contourStrength ?? 0.35,
    };
  },
} as const satisfies ShaderModule<SwissHillshadeProps>;

export const DemElevationColor = {
  name: DEM_COLOR_MODULE_NAME,
  fs: `\
uniform ${DEM_COLOR_MODULE_NAME}Uniforms {
  float elevationMin;
  float elevationMax;
} ${DEM_COLOR_MODULE_NAME};
`,
  inject: {
    "fs:#decl": /* glsl */ `
vec3 demElevationColor_palette(float elevation) {
  float t = clamp(
    (elevation - ${DEM_COLOR_MODULE_NAME}.elevationMin) /
    max(${DEM_COLOR_MODULE_NAME}.elevationMax - ${DEM_COLOR_MODULE_NAME}.elevationMin, 1.0),
    0.0,
    1.0
  );

  vec3 valley = vec3(0.72, 0.67, 0.52);
  vec3 pasture = vec3(0.58, 0.64, 0.49);
  vec3 rock = vec3(0.61, 0.56, 0.49);
  vec3 snow = vec3(0.95, 0.92, 0.84);
  vec3 color = mix(valley, pasture, smoothstep(0.04, 0.36, t));
  color = mix(color, rock, smoothstep(0.34, 0.74, t));
  color = mix(color, snow, smoothstep(0.78, 0.96, t));
  return color;
}
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float elevation = color.r;
      if (elevation < -9000.0) {
        discard;
      }

      color = vec4(demElevationColor_palette(elevation), 1.0);
    `,
  },
  uniformTypes: {
    elevationMin: "f32",
    elevationMax: "f32",
  },
  getUniforms: (props: Partial<DemColorProps>) => {
    return {
      elevationMin: props.elevationMin ?? 2800,
      elevationMax: props.elevationMax ?? 4500,
    };
  },
} as const satisfies ShaderModule<DemColorProps>;

export async function getFloatDemTileData(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<HillshadeTileData> {
  const { device, x, y, signal, pool } = options;
  const tile = await image.fetchTile(x, y, {
    boundless: false,
    pool,
    signal,
  });
  const { array } = tile;

  if (array.layout === "band-separate") {
    throw new Error(
      "DEM tiles are expected to have one pixel-interleaved band",
    );
  }

  const texture = device.createTexture({
    data: array.data,
    format: "r32float",
    width: array.width,
    height: array.height,
    sampler: {
      minFilter: "nearest",
      magFilter: "nearest",
    },
  });

  return {
    texture,
    width: array.width,
    height: array.height,
    byteLength: array.data.byteLength,
  };
}

export function renderSwissHillshade(
  tileData: HillshadeTileData,
  options: Omit<SwissHillshadeProps, "demTexture" | "textureSize">,
): RenderTileResult {
  return {
    renderPipeline: [
      { module: CreateTexture, props: { textureName: tileData.texture } },
      {
        module: SwissHillshade,
        props: {
          ...options,
          demTexture: tileData.texture,
          textureSize: [tileData.width, tileData.height],
        },
      },
    ],
  };
}

export function renderDemElevationColor(
  tileData: HillshadeTileData,
  options: DemColorProps,
): RenderTileResult {
  return {
    renderPipeline: [
      { module: CreateTexture, props: { textureName: tileData.texture } },
      {
        module: DemElevationColor,
        props: options,
      },
    ],
  };
}
