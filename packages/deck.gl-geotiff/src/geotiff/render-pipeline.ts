import { Photometric, SampleFormat } from "@cogeotiff/core";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import type { RasterModule } from "@developmentseed/deck.gl-raster/gpu-modules";
import {
  BlackIsZero,
  CMYKToRGB,
  Colormap,
  CreateTexture,
  cieLabToRGB,
  FilterNoDataVal,
  MaskTexture,
  WhiteIsZero,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import { parseColormap } from "@developmentseed/geotiff";
import type { Device, SamplerProps, Texture } from "@luma.gl/core";
import type { GetTileDataOptions } from "../cog-layer.js";
import { addAlphaChannel } from "./geotiff.js";
import { inferTextureFormat } from "./texture.js";

export type TextureDataT = {
  height: number;
  width: number;
  byteLength: number;
  texture: Texture;
  mask?: Texture;
};

/**
 * A raster module that can be "unresolved", meaning that its props may come
 * from the result of `getTileData`.
 *
 * In this case, one or more of the props may be a function that takes the
 * `getTileData` result and returns the actual prop value.
 */
// TODO: it would be nice to improve the generics here, to connect the type of
// the props allowed by the module to the return type of this function
type UnresolvedRasterModule<DataT> =
  | RasterModule
  | {
      module: RasterModule["module"];
      props?: Record<
        string,
        number | Texture | ((data: DataT) => number | Texture)
      >;
    };

export function inferRenderPipeline(
  geotiff: GeoTIFF,
  device: Device,
): {
  getTileData: (
    image: GeoTIFF | Overview,
    options: GetTileDataOptions,
  ) => Promise<TextureDataT>;
  renderTile: (data: TextureDataT) => RenderTileResult;
} {
  const { sampleFormat } = geotiff.cachedTags;
  if (sampleFormat === null) {
    throw new Error("SampleFormat tag is required to infer render pipeline");
  }

  switch (sampleFormat[0]) {
    // Unsigned integers
    case SampleFormat.Uint:
      return createUnormPipeline(geotiff, device);
  }

  throw new Error(
    `Inferring render pipeline for non-unsigned integers not yet supported. Found SampleFormat: ${sampleFormat}`,
  );
}

/**
 * Create pipeline for visualizing unsigned-integer data.
 */
function createUnormPipeline(
  geotiff: GeoTIFF,
  device: Device,
): {
  getTileData: (
    image: GeoTIFF | Overview,
    options: GetTileDataOptions,
  ) => Promise<TextureDataT>;
  renderTile: (data: TextureDataT) => RenderTileResult;
} {
  const {
    bitsPerSample,
    colorMap,
    photometric,
    sampleFormat,
    samplesPerPixel,
    nodata,
  } = geotiff.cachedTags;

  const renderPipeline: UnresolvedRasterModule<TextureDataT>[] = [
    {
      module: CreateTexture,
      props: {
        textureName: (data: TextureDataT) => data.texture,
      },
    },
  ];

  if (nodata !== null) {
    // Since values are 0-1 for unorm textures, scale nodata to [0, 1]
    const maxVal = 2 ** bitsPerSample[0]! - 1;
    const noDataScaled = nodata / maxVal;

    renderPipeline.push({
      module: FilterNoDataVal,
      props: { value: noDataScaled },
    });
  }

  if (geotiff.maskImage !== null) {
    renderPipeline.push({
      module: MaskTexture,
      props: {
        // TODO: how to handle if mask failed to load and is undefined here
        maskTexture: (data: TextureDataT) => data.mask as Texture,
      },
    });
  }

  const toRGBModule = photometricInterpretationToRGB({
    count: samplesPerPixel,
    photometric,
    device,
    colorMap,
  });
  if (toRGBModule) {
    renderPipeline.push(toRGBModule);
  }

  // For palette images, use nearest-neighbor sampling, because indices into a
  // colormap can't be interpolated
  const samplerOptions: SamplerProps =
    photometric === Photometric.Palette
      ? {
          magFilter: "nearest",
          minFilter: "nearest",
        }
      : {
          magFilter: "linear",
          minFilter: "linear",
        };

  const getTileData = async (
    image: GeoTIFF | Overview,
    options: GetTileDataOptions,
  ) => {
    const { device, x, y, signal, pool } = options;
    const tile = await image.fetchTile(x, y, {
      boundless: false,
      pool,
      signal,
    });
    let { array } = tile;
    const { width, height, mask } = array;

    let numSamples = samplesPerPixel;

    if (samplesPerPixel === 3) {
      // WebGL2 doesn't have an RGB-only texture format; it requires RGBA.
      array = addAlphaChannel(array);
      numSamples = 4;
    }

    if (array.layout === "band-separate") {
      throw new Error("Band-separate images not yet implemented.");
    }

    const textureFormat = inferTextureFormat(
      // Add one sample for added alpha channel
      numSamples,
      bitsPerSample,
      sampleFormat,
    );
    let byteLength = array.data.byteLength;
    const texture = device.createTexture({
      data: array.data,
      format: textureFormat,
      width,
      height,
      sampler: samplerOptions,
    });

    let maskTexture: Texture | undefined;
    if (mask !== null) {
      maskTexture = device.createTexture({
        data: mask,
        // Single-channel 8-bit texture for the mask
        format: "r8unorm",
        width,
        height,
        // Use nearest filtering for the mask to avoid interpolated edges/halos
        sampler: {
          minFilter: "nearest",
          magFilter: "nearest",
        },
      });
      byteLength += mask.byteLength;
    }

    return {
      texture,
      mask: maskTexture,
      byteLength,
      height: array.height,
      width: array.width,
    };
  };
  const renderTile = (tileData: TextureDataT): RenderTileResult => {
    return {
      renderPipeline: renderPipeline.map((m, _i) => resolveModule(m, tileData)),
    };
  };

  return { getTileData, renderTile };
}

function photometricInterpretationToRGB({
  count,
  colorMap,
  device,
  photometric,
}: {
  count: number;
  colorMap?: Uint16Array;
  device: Device;
  photometric: Photometric;
}): RasterModule | null {
  if (count === 3 || count === 4) {
    // Always interpret 3-band or 4-band images as RGB/RGBA
    return null;
  }

  switch (photometric) {
    case Photometric.MinIsWhite: {
      return {
        module: WhiteIsZero,
      };
    }
    case Photometric.MinIsBlack: {
      return {
        module: BlackIsZero,
      };
    }
    case Photometric.Rgb:
      return null;
    case Photometric.Palette: {
      if (!colorMap) {
        throw new Error(
          "ColorMap is required for PhotometricInterpretation Palette",
        );
      }
      const { data, width, height } = parseColormap(colorMap);
      const cmapTexture = device.createTexture({
        dimension: "2d-array",
        data,
        format: "rgba8unorm",
        width,
        height,
        depth: 1,
        mipLevels: 1,
        sampler: {
          minFilter: "nearest",
          magFilter: "nearest",
          addressModeU: "clamp-to-edge",
          addressModeV: "clamp-to-edge",
          addressModeW: "clamp-to-edge",
        },
      });
      return {
        module: Colormap,
        props: {
          colormapTexture: cmapTexture,
        },
      };
    }

    // Not sure why cogeotiff calls this "Separated", but it means CMYK
    case Photometric.Separated:
      return {
        module: CMYKToRGB,
      };
    case Photometric.Ycbcr:
      // @developmentseed/geotiff currently uses canvas to parse JPEG-compressed
      // YCbCr images, which means the YCbCr->RGB conversion is already done by
      // the browser's image decoder
      return null;
    case Photometric.Cielab:
      return {
        module: cieLabToRGB,
      };

    default:
      throw new Error(`Unsupported PhotometricInterpretation ${photometric}`);
  }
}

/**
 * If any prop of any module is a function, replace that prop value with the
 * result of that function
 */
function resolveModule<T>(m: UnresolvedRasterModule<T>, data: T): RasterModule {
  const { module, props } = m;

  if (!props) {
    return { module };
  }

  const resolvedProps: Record<string, number | Texture> = {};
  for (const [key, value] of Object.entries(props)) {
    const newValue = typeof value === "function" ? value(data) : value;
    if (newValue !== undefined) {
      resolvedProps[key] = newValue;
    }
  }

  return { module, props: resolvedProps };
}
