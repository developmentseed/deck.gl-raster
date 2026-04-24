import type { _TileLoadProps as TileLoadProps } from "@deck.gl/geo-layers";
import type {
  GetTileDataOptions,
  MinimalTileData,
  RasterModule,
  RenderTileResult,
  TilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import { TileMatrixSetAdaptor } from "@developmentseed/deck.gl-raster";
import {
  CreateTexture,
  MaskTexture,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import type { Texture } from "@luma.gl/core";
import { load } from "npyjs";
import proj4 from "proj4";

export const COG_URL =
  "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif";
export const TITILER_BASE = "https://titiler.xyz";

/**
 * Subset of the TileJSON response from titiler's
 * `/cog/tilejson.json?url=...&tileMatrixSetId=WebMercatorQuad`.
 *
 * `bounds` is in WGS84 — unlike `/cog/info`, which returns bounds in the
 * COG's native CRS (e.g. UTM for Sentinel-2) that can't be handed to a
 * MapLibre map directly.
 */
export type TileJSON = {
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  tiles: string[];
  [key: string]: unknown;
};

export type TileData = MinimalTileData & {
  texture: Texture;
  mask?: Texture;
};

/**
 * Build a TilesetDescriptor for a WebMercatorQuad tile pyramid. The CRS of
 * WebMercatorQuad is EPSG:3857, so the to/from 3857 projections are identity;
 * to/from 4326 use proj4.
 *
 * `geographicBounds` (WGS84 [w, s, e, n]) is required: titiler's
 * `/tileMatrixSets/WebMercatorQuad` response omits the optional
 * `boundingBox`, but `TileMatrixSetAdaptor` needs one for viewport culling.
 * We project the dataset's geographic bounds to EPSG:3857 and attach them.
 */
export function buildDescriptor(
  tms: TileMatrixSet,
  geographicBounds: [number, number, number, number],
): TilesetDescriptor {
  const converter = proj4("EPSG:3857", "EPSG:4326");
  const projectTo4326 = (x: number, y: number) =>
    converter.forward<[number, number]>([x, y], false);
  const projectFrom4326 = (x: number, y: number) =>
    converter.inverse<[number, number]>([x, y], false);
  const identity = (x: number, y: number): [number, number] => [x, y];
  const [w, s, e, n] = geographicBounds;
  const lowerLeft = projectFrom4326(w, s);
  const upperRight = projectFrom4326(e, n);
  const tmsWithBbox: TileMatrixSet = {
    ...tms,
    boundingBox: { lowerLeft, upperRight, crs: tms.crs },
  };
  return new TileMatrixSetAdaptor(tmsWithBbox, {
    projectTo3857: identity,
    projectFrom3857: identity,
    projectTo4326,
    projectFrom4326,
  });
}

/**
 * Repack a band-separate uint8 buffer of shape [B, H, W] into an interleaved
 * RGBA uint8 buffer of length H*W*4. Bands 0-2 go to R/G/B; alpha is always
 * 255 (the 4th titiler band is a mask, handled separately).
 */
function repackToRGBA(
  bandSeparate: Uint8Array,
  height: number,
  width: number,
): Uint8Array {
  const pixelCount = height * width;
  const rgba = new Uint8Array(pixelCount * 4);
  const bandOffset1 = pixelCount;
  const bandOffset2 = 2 * pixelCount;
  for (let i = 0; i < pixelCount; i++) {
    rgba[i * 4] = bandSeparate[i]!;
    rgba[i * 4 + 1] = bandSeparate[bandOffset1 + i]!;
    rgba[i * 4 + 2] = bandSeparate[bandOffset2 + i]!;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function tileNpyUrl(x: number, y: number, z: number): string {
  return `${TITILER_BASE}/cog/tiles/WebMercatorQuad/${z}/${x}/${y}.npy?url=${encodeURIComponent(COG_URL)}`;
}

/**
 * Fetch one titiler .npy tile, decode it, and upload the resulting RGBA
 * texture (plus a separate mask texture when the response has 4 bands).
 *
 * Note: textures are not explicitly destroyed when the tile cache evicts them.
 * This matches the COGLayer pattern in this repo; fine for example/demo use,
 * but a long-running app should wire an onTileUnload callback through the
 * underlying TileLayer and call `.destroy()` on both textures.
 */
export async function getTileData(
  tile: TileLoadProps,
  options: GetTileDataOptions,
): Promise<TileData> {
  const { device, signal } = options;
  const { x, y, z } = tile.index;
  const response = await fetch(tileNpyUrl(x, y, z), { signal });
  if (!response.ok) {
    throw new Error(
      `titiler tile ${z}/${x}/${y} ${response.status}: ${await response.text()}`,
    );
  }
  const buffer = await response.arrayBuffer();
  const parsed = await load(buffer);
  if (parsed.dtype !== "u1") {
    throw new Error(`Expected uint8 (u1) npy, got dtype=${parsed.dtype}`);
  }
  if (!(parsed.data instanceof Uint8Array)) {
    throw new Error(
      `Expected Uint8Array payload for dtype=u1, got ${parsed.data?.constructor?.name}`,
    );
  }
  if (parsed.shape.length !== 3) {
    throw new Error(
      `Expected shape [B, H, W], got [${parsed.shape.join(", ")}]`,
    );
  }
  const [bands, height, width] = parsed.shape as [number, number, number];
  if (bands !== 3 && bands !== 4) {
    throw new Error(`Expected 3 or 4 bands, got ${bands}`);
  }
  const data = parsed.data;
  const rgba = repackToRGBA(data, height, width);
  const texture = device.createTexture({
    data: rgba,
    format: "rgba8unorm",
    width,
    height,
    sampler: { minFilter: "linear", magFilter: "linear" },
  });
  let mask: Texture | undefined;
  let byteLength = rgba.byteLength;
  if (bands === 4) {
    const maskBand = data.subarray(3 * height * width, 4 * height * width);
    mask = device.createTexture({
      data: maskBand,
      format: "r8unorm",
      width,
      height,
      sampler: { minFilter: "nearest", magFilter: "nearest" },
    });
    byteLength += maskBand.byteLength;
  }
  return { width, height, byteLength, texture, mask };
}

export function renderTile(data: TileData): RenderTileResult {
  const pipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: data.texture } },
  ];
  if (data.mask) {
    pipeline.push({
      module: MaskTexture,
      props: { maskTexture: data.mask },
    });
  }
  return { renderPipeline: pipeline };
}
