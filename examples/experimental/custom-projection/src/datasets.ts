import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type {
  MinimalTileData,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import {
  COLORMAP_INDEX,
  Colormap,
  CreateTexture,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";

/** A COG the example can display. */
export type Dataset = {
  /** Stable identifier. */
  id: string;
  /** Display name. */
  title: string;
  /** COG URL (CORS-enabled). */
  url: string;
  /**
   * `"rgb"` renders through `COGLayer`'s default pipeline; `"elevation"`
   * decodes int16 heights and colors them on the GPU.
   */
  kind: "rgb" | "elevation";
  /** One-line description for the control panel. */
  description: string;
  /** Required credit line. */
  attribution: string;
  /** Link for the credit line. */
  attributionUrl: string;
  /**
   * Ids of the projection presets this source is offered in (all when
   * omitted). Polar-native rasters that contain a pole only render correctly
   * in their own polar projection: in a world projection the pole stretches
   * into a line and the tiles straddle the antimeridian seam, which a single
   * mesh per tile can't represent.
   */
  projections?: string[];
};

/**
 * Source Cooperative objects are read straight from S3: data.source.coop
 * adds latency and doesn't always send `Content-Length` (see the aef-mosaic
 * example).
 */
const SOURCE_COOP_S3 =
  "https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop";

/** Datasets offered in the example. */
export const DATASETS: Dataset[] = [
  {
    id: "gebco",
    title: "GEBCO 2026 elevation (global)",
    url: `${SOURCE_COOP_S3}/ausantarctic/gebco/GEBCO_2026.tif`,
    kind: "elevation",
    description:
      "Global land and ocean-floor elevation in EPSG:4326, reprojected on the fly into the map's projection — including both poles.",
    attribution: "GEBCO Compilation Group (2026) GEBCO 2026 Grid",
    attributionUrl: "https://www.gebco.net/",
  },
  {
    id: "nasa-antarctic",
    title: "NASA Explorer Base Map (EPSG:3031)",
    url: `${SOURCE_COOP_S3}/scar/distant/supporting/EO-basemap_ps_cog.tif`,
    kind: "rgb",
    projections: ["antarctic"],
    description:
      "A COG that is natively in Antarctic Polar Stereographic, covering the whole Southern Hemisphere.",
    attribution:
      "NASA Earth Observatory map by Joshua Stevens (MODIS Land Cover, SRTM, GEBCO, Natural Earth), via SCAR DistAnt, CC BY 4.0",
    attributionUrl: "https://doi.org/10.5281/zenodo.10910075",
  },
  {
    id: "eox-cloudless",
    title: "EOxCloudless 2024 (global)",
    url: "https://s3.us-east-1.amazonaws.com/ds-deck.gl-raster-public/cog/viewing-basic_s2cloudless-2024_geodetic-zoom-3_3bands_8bit.tif",
    kind: "rgb",
    description:
      "Cloudless Sentinel-2 mosaic in EPSG:4326. Sentinel-2 doesn't image the high Arctic or the open Southern Ocean, so expect holes there.",
    attribution:
      "EOxCloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0",
    attributionUrl: "https://cloudless.eox.at",
  },
];

/** Tile data for elevation datasets: heights as an r32float texture. */
export type ElevationTileData = MinimalTileData & {
  /** Single-channel float texture of heights in meters. */
  texture: Texture;
  /** Byte length, for deck.gl's byte-based tile cache. */
  byteLength: number;
};

/**
 * Fetch one tile of an int16 elevation COG and upload it as float heights.
 *
 * `COGLayer`'s default pipeline only handles unsigned integers, and integer
 * textures can't be sampled with filtering, so convert to float32 on the CPU.
 */
export async function getElevationTileData(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<ElevationTileData> {
  const { device, x, y, signal, pool } = options;
  const { array } = await image.fetchTile(x, y, {
    boundless: false,
    pool,
    signal,
  });
  const { width, height } = array;
  const heights =
    array.layout === "band-separate" ? array.bands[0]! : array.data;
  const data = Float32Array.from(heights as ArrayLike<number>);
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

/**
 * Heights mapped onto cmocean's `topo` colormap. The range is symmetric so
 * that sea level lands on the colormap's land/sea break.
 */
const ELEVATION_RESCALE = { rescaleMin: -6500, rescaleMax: 6500 };

/** Build the GPU pipeline that colors elevation tiles. */
export function makeRenderElevationTile(colormapTexture: Texture) {
  return function renderElevationTile(
    data: ElevationTileData,
  ): RenderTileResult {
    return {
      renderPipeline: [
        { module: CreateTexture, props: { textureName: data.texture } },
        { module: LinearRescale, props: ELEVATION_RESCALE },
        {
          module: Colormap,
          props: {
            colormapTexture,
            colormapIndex: COLORMAP_INDEX.topo,
            reversed: false,
          },
        },
      ],
    };
  };
}
