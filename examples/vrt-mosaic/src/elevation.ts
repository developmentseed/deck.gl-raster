import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type {
  MinimalTileData,
  RasterModule,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  CreateTexture,
  FilterNoDataVal,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";

/** One tile of elevation, uploaded as a single-channel float texture. */
export type ElevationTileData = MinimalTileData & {
  /** `r32float` texture of the tile's elevations. */
  texture: Texture;
  /** The COG's nodata value, if it has one. */
  nodata: number | null;
};

/** How to color elevation: a colormap stretched over `range`. */
export type ElevationStyle = {
  /** The colormap sprite texture. */
  colormapTexture: Texture;
  /** Which row of the sprite to sample. */
  colormapIndex: number;
  /** `[min, max]` elevation, in the data's units, mapped to the colormap's ends. */
  range: [number, number];
};

/**
 * Fetch one tile of a single-band Float32 COG and upload it as an `r32float`
 * texture.
 *
 * The COG layer's default pipeline only handles unsigned integers, so float
 * data needs its own `getTileData` and `renderTile`.
 */
export async function getTileData(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<ElevationTileData> {
  const { device, x, y, signal, pool } = options;
  const { array } = await image.fetchTile(x, y, {
    boundless: false,
    pool,
    signal,
  });
  const data =
    array.layout === "pixel-interleaved" ? array.data : array.bands[0];
  if (array.count !== 1 || !(data instanceof Float32Array)) {
    throw new Error("Expected a single-band Float32 elevation tile");
  }

  const { width, height, nodata } = array;
  const texture = device.createTexture({
    format: "r32float",
    width,
    height,
    data,
    // r32float can only be filtered linearly with OES_texture_float_linear
    sampler: {
      minFilter: "nearest",
      magFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    },
  });
  return { texture, width, height, byteLength: data.byteLength, nodata };
}

/**
 * Render a tile from {@link getTileData}: discard nodata, stretch `range` to
 * `[0, 1]` and look up the colormap.
 */
export function renderElevation(
  data: ElevationTileData,
  style: ElevationStyle,
): RenderTileResult {
  const { colormapTexture, colormapIndex, range } = style;
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: data.texture } },
  ];
  if (data.nodata !== null) {
    // Before the rescale, which would clamp the nodata value into range
    renderPipeline.push({
      module: FilterNoDataVal,
      props: { value: data.nodata },
    });
  }
  renderPipeline.push(
    {
      module: LinearRescale,
      props: { rescaleMin: range[0], rescaleMax: range[1] },
    },
    { module: Colormap, props: { colormapTexture, colormapIndex } },
  );
  return { renderPipeline };
}
