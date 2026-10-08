import type { _TileLoadProps as TileLoadProps } from "@deck.gl/geo-layers";
import type {
  GetTileDataOptions,
  MinimalTileData,
  RasterModule,
  RasterTilesetDescriptor,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import { TileMatrixSetAdaptor } from "@developmentseed/deck.gl-raster";
import {
  CreateTexture,
  MaskTexture,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import type { Texture } from "@luma.gl/core";
import { parse } from "npyjs";
import proj4 from "proj4";

/** Public titiler instance that serves the tiles. */
export const TITILER_URL = "https://titiler.xyz";

/** Sentinel-2 true color COG that titiler reads the tiles from. */
export const COG_URL =
  "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif";

/**
 * The OGC tile matrix set titiler cuts tiles in. Its CRS is EPSG:3857.
 */
const TILE_MATRIX_SET_ID = "WebMercatorQuad";

/**
 * Query parameter that gives each site its own entries in titiler.xyz's CDN
 * cache. titiler itself ignores it.
 *
 * titiler echoes the request's `Origin` header back as the CORS
 * `Access-Control-Allow-Origin` header, but the CDN caches responses without
 * regard to `Origin`. Without this parameter, the CDN can serve this page a
 * response cached for another site, or for a request with no `Origin` (e.g.
 * curl), and the browser blocks it.
 *
 * This uses the host, not the full origin, because the CDN rejects query
 * strings that contain `http://localhost`.
 */
const CACHE_KEY_PARAM = `host=${encodeURIComponent(window.location.host)}`;

/** WGS84 bounds, as `[west, south, east, north]`. */
type Bounds = [number, number, number, number];

/**
 * Subset of titiler's TileJSON response from
 * `/cog/{tileMatrixSetId}/tilejson.json`.
 *
 * `bounds` is in WGS84, unlike `/cog/info`, which returns bounds in the COG's
 * native CRS (UTM for Sentinel-2).
 */
type TileJSON = {
  bounds: Bounds;
  maxzoom: number;
  /** titiler extension: numpy dtype of the tile data, e.g. `"uint8"`. */
  data_type?: string;
  /** titiler extension: one `[name, description]` pair per data band. */
  band_descriptions?: [string, string][];
};

/** What the app needs to know about the dataset before rendering tiles. */
export type TitilerSource = {
  /** Tile pyramid of the tile matrix set, bounded to the dataset. */
  descriptor: RasterTilesetDescriptor;
  /** Dataset bounds in WGS84. */
  bounds: Bounds;
  /** Zoom level at which the tiles reach the COG's full resolution. */
  maxZoom: number;
  /** numpy dtype of the tile data, e.g. `"uint8"`, if titiler reports it. */
  dataType?: string;
  /** Number of data bands, not counting the mask, if titiler reports it. */
  bandCount?: number;
};

/** Tile data returned by {@link getTileData}. */
export type TileData = MinimalTileData & {
  /** RGB imagery, uploaded as an RGBA texture. */
  texture: Texture;
  /** titiler's mask band: 0 where the COG has no data, 255 elsewhere. */
  mask?: Texture;
};

/** Fetch a JSON document, throwing with the response body on HTTP errors. */
async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `${url} returned ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

/**
 * Fetch the dataset's TileJSON and the tile matrix set definition from
 * titiler, and build the tileset descriptor that `RasterTileLayer` traverses.
 */
export async function loadTitilerSource({
  signal,
}: {
  signal?: AbortSignal;
}): Promise<TitilerSource> {
  const tilejsonUrl = `${TITILER_URL}/cog/${TILE_MATRIX_SET_ID}/tilejson.json?url=${encodeURIComponent(COG_URL)}&${CACHE_KEY_PARAM}`;
  const tmsUrl = `${TITILER_URL}/tileMatrixSets/${TILE_MATRIX_SET_ID}?${CACHE_KEY_PARAM}`;
  const [tilejson, tms] = await Promise.all([
    fetchJson<TileJSON>(tilejsonUrl, signal),
    fetchJson<TileMatrixSet>(tmsUrl, signal),
  ]);
  return {
    descriptor: buildDescriptor(tms, tilejson.bounds),
    bounds: tilejson.bounds,
    maxZoom: tilejson.maxzoom,
    dataType: tilejson.data_type,
    bandCount: tilejson.band_descriptions?.length,
  };
}

/**
 * Build a tileset descriptor for the WebMercatorQuad tile matrix set.
 *
 * WebMercatorQuad's CRS is EPSG:3857, so the to/from 3857 projections are
 * identity and the to/from 4326 projections use proj4.
 *
 * titiler's `/tileMatrixSets/{tileMatrixSetId}` response omits the optional
 * `boundingBox`, but `TileMatrixSetAdaptor` needs one for viewport culling. We
 * attach the dataset's geographic bounds, projected to EPSG:3857.
 */
function buildDescriptor(
  tms: TileMatrixSet,
  geographicBounds: Bounds,
): RasterTilesetDescriptor {
  const converter = proj4("EPSG:3857", "EPSG:4326");
  const projectTo4326 = (x: number, y: number) =>
    converter.forward<[number, number]>([x, y], false);
  const projectFrom4326 = (x: number, y: number) =>
    converter.inverse<[number, number]>([x, y], false);
  const identity = (x: number, y: number): [number, number] => [x, y];
  const [west, south, east, north] = geographicBounds;
  const tmsWithBbox: TileMatrixSet = {
    ...tms,
    boundingBox: {
      lowerLeft: projectFrom4326(west, south),
      upperRight: projectFrom4326(east, north),
      crs: tms.crs,
    },
  };
  return new TileMatrixSetAdaptor(tmsWithBbox, {
    projectTo3857: identity,
    projectFrom3857: identity,
    projectTo4326,
    projectFrom4326,
  });
}

/** URL of one tile, as a numpy `.npy` array. */
function tileUrl({ x, y, z }: { x: number; y: number; z: number }): string {
  return `${TITILER_URL}/cog/tiles/${TILE_MATRIX_SET_ID}/${z}/${x}/${y}.npy?url=${encodeURIComponent(COG_URL)}&${CACHE_KEY_PARAM}`;
}

/**
 * Repack band-separate uint8 data of shape `[bands, height, width]` into
 * interleaved RGBA. Bands 0-2 become R, G and B; alpha is always 255, since
 * titiler's 4th band is a mask, which we upload as its own texture.
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

/**
 * Fetch one tile from titiler as a `.npy` array, decode it, and upload it to
 * the GPU: an RGBA texture for the imagery, plus a mask texture when titiler
 * includes a mask band (the default).
 *
 * The caller owns the returned textures and must destroy them when deck.gl
 * evicts the tile, in `onTileUnload`.
 */
export async function getTileData(
  tile: TileLoadProps,
  options: GetTileDataOptions,
): Promise<TileData> {
  const { device, signal } = options;
  const { x, y, z } = tile.index;
  const response = await fetch(tileUrl({ x, y, z }), { signal });
  if (!response.ok) {
    throw new Error(
      `titiler tile ${z}/${x}/${y} returned ${response.status}: ${await response.text()}`,
    );
  }
  const { data, dtype, shape, fortranOrder } = parse(
    await response.arrayBuffer(),
  );
  if (dtype !== "u1" || !(data instanceof Uint8Array)) {
    throw new Error(`Expected uint8 (u1) tile data, got dtype=${dtype}`);
  }
  if (fortranOrder || shape.length !== 3) {
    throw new Error(
      `Expected C-order data of shape [bands, height, width], got [${shape.join(", ")}]${fortranOrder ? " in Fortran order" : ""}`,
    );
  }
  const [bands, height, width] = shape as [number, number, number];
  if (bands !== 3 && bands !== 4) {
    throw new Error(`Expected 3 bands, or 3 bands and a mask; got ${bands}`);
  }

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
      // MaskTexture compares against exactly 0, so never interpolate.
      sampler: { minFilter: "nearest", magFilter: "nearest" },
    });
    byteLength += maskBand.byteLength;
  }
  return { width, height, byteLength, texture, mask };
}

/** Render a tile: sample the imagery texture, discarding masked pixels. */
export function renderTile(data: TileData): RenderTileResult {
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: data.texture } },
  ];
  if (data.mask) {
    renderPipeline.push({
      module: MaskTexture,
      props: { maskTexture: data.mask },
    });
  }
  return { renderPipeline };
}
