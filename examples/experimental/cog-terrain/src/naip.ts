import type { _Tile2DHeader as Tile2DHeader } from "@deck.gl/geo-layers";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import { CreateTexture } from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * 2023 NAIP imagery around Pikes Peak, CO: a 3 x 3 block of quarter
 * quadrangles from the naip-mosaic example's list, north to south.
 */
export const NAIP_PIKES_PEAK_URLS = [
  "38105/m_3810508_sw_13_030_20231010_20240104.tif",
  "38105/m_3810508_se_13_030_20231010_20240104.tif",
  "38104/m_3810401_sw_13_030_20231010_20240104.tif",
  "38105/m_3810516_nw_13_030_20231010_20240104.tif",
  "38105/m_3810516_ne_13_030_20231010_20240104.tif",
  "38104/m_3810409_nw_13_030_20231010_20240104.tif",
  "38105/m_3810516_sw_13_030_20231010_20240104.tif",
  "38105/m_3810516_se_13_030_20231010_20240104.tif",
  "38104/m_3810409_sw_13_030_20231010_20240104.tif",
].map(
  (path) =>
    `https://naipeuwest.blob.core.windows.net/naip/v002/co/2023/co_030cm_2023/${path}`,
);

/** A NAIP tile uploaded to the GPU. */
export type NaipTileData = {
  texture: Texture;
  width: number;
  height: number;
  byteLength: number;
};

/**
 * Upload a NAIP tile's four bands (red, green, blue and near-infrared) as one
 * RGBA texture.
 */
async function getTileData(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<NaipTileData> {
  const { device, x, y, signal, pool } = options;
  const { array } = await image.fetchTile(x, y, {
    boundless: false,
    pool,
    signal,
  });
  if (array.layout === "band-separate") {
    throw new Error("NAIP tiles are pixel interleaved");
  }
  // The signal stops the fetch but not the decode, so a tile cancelled while
  // decoding still gets here. deck.gl doesn't unload a tile that loads after
  // its layer is gone, so a texture made for it would never be destroyed.
  signal?.throwIfAborted();
  const { width, height, data } = array;
  const texture = device.createTexture({
    data,
    format: "rgba8unorm",
    width,
    height,
    // luma.gl's default is nearest, which draws magnified pixels as squares.
    sampler: { magFilter: "linear", minFilter: "linear" },
  });
  return { texture, width, height, byteLength: data.byteLength };
}

/**
 * Sets alpha to 1. The texture's alpha channel holds NAIP's fourth band,
 * near-infrared, which would otherwise make the imagery partly transparent.
 */
const SetAlpha1 = {
  name: "set-alpha-1",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = vec4(color.rgb, 1.0);
    `,
  },
} as const satisfies ShaderModule;

/**
 * Shows near-infrared as red, red as green and green as blue: a false-color
 * infrared composite, in which healthy vegetation is bright red.
 */
const FalseColorInfrared = {
  name: "false-color-infrared",
  inject: {
    // The texture holds red, green, blue and near-infrared.
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color.rgb = vec3(color.a, color.r, color.g);
    `,
  },
} as const satisfies ShaderModule;

/** Render a NAIP tile's red, green and blue bands. */
function renderTrueColor(data: NaipTileData): RenderTileResult {
  return {
    renderPipeline: [
      { module: CreateTexture, props: { textureName: data.texture } },
      { module: SetAlpha1 },
    ],
  };
}

/** Render a NAIP tile as false-color infrared. */
function renderFalseColorInfrared(data: NaipTileData): RenderTileResult {
  return {
    renderPipeline: [
      { module: CreateTexture, props: { textureName: data.texture } },
      { module: FalseColorInfrared },
      { module: SetAlpha1 },
    ],
  };
}

/**
 * COGLayer props that draw NAIP in true color. COGLayer's default pipeline
 * would draw the near-infrared band as alpha.
 */
export const NAIP_TILE_PROPS = {
  getTileData,
  renderTile: renderTrueColor,
  onTileUnload: (tile: Tile2DHeader<NaipTileData>) =>
    tile.content?.texture.destroy(),
  // Keep tiles out of view only while each COG's tiles, counting those in
  // view, total under 64 MB, about 64 tiles. Tiles in view are never evicted.
  // Without a byte budget, TileLayer keeps up to five times as many tiles as
  // are selected, and a tilted view over NAIP selects hundreds.
  maxCacheByteSize: 64 * 1024 * 1024,
};

/** COGLayer props that draw NAIP as false-color infrared. */
export const NAIP_FALSE_COLOR_TILE_PROPS = {
  ...NAIP_TILE_PROPS,
  renderTile: renderFalseColorInfrared,
};
