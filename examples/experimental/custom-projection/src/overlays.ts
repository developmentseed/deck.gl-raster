import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type {
  MinimalTileData,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import {
  COLORMAP_INDEX,
  Colormap,
  CreateTexture,
  FilterNoDataVal,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";

/** A data layer drawn over the raster. */
export type Overlay = {
  /** Stable identifier. */
  id: string;
  /** Display name. */
  title: string;
  /** COG URL (CORS-enabled). */
  url: string;
  /** One-line description for the control panel. */
  description: string;
  /** Required credit line. */
  attribution: string;
  /** Link for the credit line. */
  attributionUrl: string;
  /** Ids of the projection presets this overlay is offered in. */
  projections: string[];
};

const ITS_LIVE_COGS =
  "https://its-live-data.s3.us-west-2.amazonaws.com/velocity_mosaic/v2/static/cog";

const ITS_LIVE_ATTRIBUTION = {
  attribution:
    "ITS_LIVE velocity mosaics, NASA MEaSUREs (Gardner et al.), 2014–2022 climatology",
  attributionUrl: "https://its-live.jpl.nasa.gov/",
};

/** Overlays offered in the example. */
export const OVERLAYS: Overlay[] = [
  {
    id: "itslive-antarctica",
    title: "Ice velocity, Antarctica (EPSG:3031)",
    url: `${ITS_LIVE_COGS}/ITS_LIVE_velocity_120m_RGI19A_0000_v02_v.tif`,
    // Contains the South Pole, so it only renders in the Antarctic projection
    // (see `Dataset.projections`).
    projections: ["antarctic"],
    description: "Ice flow speed, natively in Antarctic Polar Stereographic.",
    ...ITS_LIVE_ATTRIBUTION,
  },
  {
    id: "itslive-greenland",
    title: "Ice velocity, Greenland (EPSG:3413)",
    url: `${ITS_LIVE_COGS}/ITS_LIVE_velocity_120m_RGI05A_0000_v02_v.tif`,
    // Stops short of the North Pole and the antimeridian, so it also renders
    // in the world projections; it is outside the Antarctic one.
    projections: ["arctic", "equal-earth", "web-mercator"],
    description: "Ice flow speed, natively in Arctic Polar Stereographic.",
    ...ITS_LIVE_ATTRIBUTION,
  },
];

/** Tile data for the velocity overlay: log10 speed as an r32float texture. */
export type VelocityTileData = MinimalTileData & {
  /** Single-channel float texture of log10(speed in m/yr). */
  texture: Texture;
  /** Byte length, for deck.gl's byte-based tile cache. */
  byteLength: number;
};

/** Written in place of nodata and non-positive speeds; discarded on the GPU. */
const NODATA_SENTINEL = -9999;

/**
 * Fetch a tile of a float32 velocity COG and upload log10(speed).
 *
 * Ice speeds span five orders of magnitude, from the slow interior to fast
 * outlet glaciers, so they are colored on a log scale.
 */
export async function getVelocityTileData(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<VelocityTileData> {
  const { device, x, y, signal, pool } = options;
  const { array } = await image.fetchTile(x, y, {
    boundless: false,
    pool,
    signal,
  });
  const { width, height, nodata } = array;
  const speeds = (
    array.layout === "band-separate" ? array.bands[0]! : array.data
  ) as ArrayLike<number>;
  const data = new Float32Array(speeds.length);
  for (let i = 0; i < speeds.length; i++) {
    const speed = speeds[i]!;
    data[i] =
      speed === nodata || !(speed > 0) ? NODATA_SENTINEL : Math.log10(speed);
  }
  const texture = device.createTexture({
    format: "r32float",
    width,
    height,
    data,
    sampler: {
      minFilter: "nearest",
      magFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    },
  });
  return { texture, byteLength: data.byteLength, width, height };
}

/** log10(m/yr): 1 m/yr to about 3 km/yr. */
const VELOCITY_RESCALE = { rescaleMin: 0, rescaleMax: 3.5 };

/** Build the GPU pipeline that colors velocity tiles. */
export function makeRenderVelocityTile(colormapTexture: Texture) {
  return function renderVelocityTile(data: VelocityTileData): RenderTileResult {
    return {
      renderPipeline: [
        { module: CreateTexture, props: { textureName: data.texture } },
        { module: FilterNoDataVal, props: { value: NODATA_SENTINEL } },
        { module: LinearRescale, props: VELOCITY_RESCALE },
        {
          module: Colormap,
          props: {
            colormapTexture,
            colormapIndex: COLORMAP_INDEX.rdylbu,
            reversed: true,
          },
        },
      ],
    };
  };
}
