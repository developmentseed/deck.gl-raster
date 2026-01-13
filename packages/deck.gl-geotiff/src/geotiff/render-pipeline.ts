import type { RasterModule } from "@developmentseed/deck.gl-raster/gpu-modules";
import {
  CMYKToRGB,
  Colormap,
  CreateTexture,
  cieLabToRGB,
  FilterNoDataVal,
  RescaleSnormToUnorm,
  YCbCrToRGB,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Device, SamplerProps, Texture } from "@luma.gl/core";
import type { GeoTIFFImage, TypedArrayWithDimensions } from "geotiff";
import type { COGLayerProps, GetTileDataOptions } from "../cog-layer";
import { addAlphaChannel, parseColormap, parseGDALNoData } from "./geotiff";
import { inferTextureFormat, verifyIdenticalBitsPerSample } from "./texture";
import type { ImageFileDirectory } from "./types";
import { PhotometricInterpretationT } from "./types";

export type TextureDataT = {
  height: number;
  width: number;
  texture: Texture;
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
  // TODO: narrow type to only used fields
  ifd: ImageFileDirectory,
  device: Device,
): {
  getTileData: COGLayerProps<TextureDataT>["getTileData"];
  renderTile: COGLayerProps<TextureDataT>["renderTile"];
} {
  const { SampleFormat } = ifd;

  switch (SampleFormat[0]) {
    // Unsigned integers
    case 1:
      return createUnormPipeline(ifd, device);
    // Signed integers
    case 2:
      return createSignedIntegerPipeline(ifd, device);
  }

  throw new Error(
    `Inferring render pipeline for non-unsigned integers not yet supported. Found SampleFormat: ${SampleFormat}`,
  );
}

/**
 * Create pipeline for visualizing unsigned-integer data.
 */
function createUnormPipeline(
  ifd: ImageFileDirectory,
  device: Device,
): {
  getTileData: COGLayerProps<TextureDataT>["getTileData"];
  renderTile: COGLayerProps<TextureDataT>["renderTile"];
} {
  const {
    BitsPerSample,
    ColorMap,
    GDAL_NODATA,
    PhotometricInterpretation,
    SampleFormat,
    SamplesPerPixel,
  } = ifd;

  const renderPipeline: UnresolvedRasterModule<TextureDataT>[] = [
    {
      module: CreateTexture,
      props: {
        textureName: (data: TextureDataT) => data.texture,
      },
    },
  ];

  // Add NoData filtering if GDAL_NODATA is defined
  const noDataVal = parseGDALNoData(GDAL_NODATA);
  if (noDataVal !== null) {
    const numBits = verifyIdenticalBitsPerSample(BitsPerSample);
    const noDataScaled = transformUnsignedIntegerNodataValue(
      noDataVal,
      numBits,
    );
    renderPipeline.push({
      module: FilterNoDataVal,
      props: { value: noDataScaled },
    });
  }

  const toRGBModule = photometricInterpretationToRGB(
    PhotometricInterpretation,
    device,
    ColorMap,
  );
  if (toRGBModule) {
    renderPipeline.push(toRGBModule);
  }

  // For palette images, use nearest-neighbor sampling
  const samplerOptions: SamplerProps =
    PhotometricInterpretation === PhotometricInterpretationT.Palette
      ? {
          magFilter: "nearest",
          minFilter: "nearest",
        }
      : {
          magFilter: "linear",
          minFilter: "linear",
        };

  const getTileData: COGLayerProps<TextureDataT>["getTileData"] = async (
    image: GeoTIFFImage,
    options: GetTileDataOptions,
  ) => {
    const { device } = options;
    const mergedOptions = {
      ...options,
      interleave: true,
    };

    let data: TypedArrayWithDimensions | ImageData = (await image.readRasters(
      mergedOptions,
    )) as TypedArrayWithDimensions;
    let numSamples = SamplesPerPixel;

    if (SamplesPerPixel === 3) {
      // WebGL2 doesn't have an RGB-only texture format; it requires RGBA.
      data = addAlphaChannel(data);
      numSamples = 4;
    }

    const textureFormat = inferTextureFormat(
      // Add one sample for added alpha channel
      numSamples,
      BitsPerSample,
      SampleFormat,
    );
    const texture = device.createTexture({
      data,
      format: textureFormat,
      width: data.width,
      height: data.height,
      sampler: samplerOptions,
    });

    return {
      texture,
      height: data.height,
      width: data.width,
    };
  };
  const renderTile: COGLayerProps<TextureDataT>["renderTile"] = (
    tileData: TextureDataT,
  ): RasterModule[] => {
    return renderPipeline.map((m, _i) => resolveModule(m, tileData));
  };

  return { getTileData, renderTile };
}

function createSignedIntegerPipeline(
  ifd: ImageFileDirectory,
  device: Device,
): {
  getTileData: COGLayerProps<TextureDataT>["getTileData"];
  renderTile: COGLayerProps<TextureDataT>["renderTile"];
} {
  const {
    BitsPerSample,
    ColorMap,
    GDAL_NODATA,
    PhotometricInterpretation,
    SampleFormat,
    SamplesPerPixel,
  } = ifd;

  const renderPipeline: UnresolvedRasterModule<TextureDataT>[] = [
    {
      module: CreateTexture,
      props: {
        textureName: (data: TextureDataT) => data.texture,
      },
    },
  ];

  const noDataVal = parseGDALNoData(GDAL_NODATA);
  if (noDataVal !== null) {
    const numBits = verifyIdenticalBitsPerSample(BitsPerSample);
    const noDataScaled = transformSignedIntegerNodataValue(noDataVal, numBits);

    renderPipeline.push({
      module: FilterNoDataVal,
      props: { value: noDataScaled },
    });
  }

  // Rescale -1 to 1 to 0 to 1
  renderPipeline.push({
    module: RescaleSnormToUnorm,
  });

  const toRGBModule = photometricInterpretationToRGB(
    PhotometricInterpretation,
    device,
    ColorMap,
  );
  if (toRGBModule) {
    renderPipeline.push(toRGBModule);
  }

  // For palette images, use nearest-neighbor sampling
  const samplerOptions: SamplerProps =
    PhotometricInterpretation === PhotometricInterpretationT.Palette
      ? {
          magFilter: "nearest",
          minFilter: "nearest",
        }
      : {
          magFilter: "linear",
          minFilter: "linear",
        };

  const getTileData: COGLayerProps<TextureDataT>["getTileData"] = async (
    image: GeoTIFFImage,
    options: GetTileDataOptions,
  ) => {
    const { device } = options;
    const mergedOptions = {
      ...options,
      interleave: true,
    };

    let data: TypedArrayWithDimensions | ImageData = (await image.readRasters(
      mergedOptions,
    )) as TypedArrayWithDimensions;
    let numSamples = SamplesPerPixel;

    if (SamplesPerPixel === 3) {
      // WebGL2 doesn't have an RGB-only texture format; it requires RGBA.
      data = addAlphaChannel(data);
      numSamples = 4;
    }

    const textureFormat = inferTextureFormat(
      // Add one sample for added alpha channel
      numSamples,
      BitsPerSample,
      SampleFormat,
    );
    const texture = device.createTexture({
      data,
      format: textureFormat,
      width: data.width,
      height: data.height,
      sampler: samplerOptions,
    });

    return {
      texture,
      height: data.height,
      width: data.width,
    };
  };
  const renderTile: COGLayerProps<TextureDataT>["renderTile"] = (
    tileData: TextureDataT,
  ): RasterModule[] => {
    return renderPipeline.map((m, _i) => resolveModule(m, tileData));
  };

  return { getTileData, renderTile };
}

/**
 * Rescale nodata values by the maximum possible value for the given bit depth.
 *
 * This is because we use unorm textures, where integer values are mapped to
 * 0-1.
 */
function transformUnsignedIntegerNodataValue(
  nodata: number,
  bits: number,
): number {
  const max = (1 << bits) - 1;
  return nodata / max;
}

/**
 * Rescale signed integer nodata values by the maximum possible value for the
 * given bit depth.
 *
 * According to ChatGPT:
 *
 * SNORM uses a symmetric divisor, not asymmetric scaling, because:
 * - GPUs want a simple, vectorizable conversion
 * - The integer range is asymmetric, but the float range is symmetric
 * - The extra negative value (-128) is treated as a sentinel that also maps to -1.0
 *
 * This is why we only divide by the positive max value.
 */
function transformSignedIntegerNodataValue(
  nodata: number,
  bits: number,
): number {
  const max = (1 << (bits - 1)) - 1;
  const min = -(1 << (bits - 1));

  if (nodata === min) {
    // SNORM special case: minimum maps exactly to -1.0
    return -1.0;
  }

  return nodata / max;
}

function photometricInterpretationToRGB(
  PhotometricInterpretation: number,
  device: Device,
  ColorMap?: Uint16Array,
): RasterModule | null {
  switch (PhotometricInterpretation) {
    case PhotometricInterpretationT.RGB:
      return null;
    case PhotometricInterpretationT.Palette: {
      if (!ColorMap) {
        throw new Error(
          "ColorMap is required for PhotometricInterpretation Palette",
        );
      }
      const { data, width, height } = parseColormap(ColorMap);
      const cmapTexture = device.createTexture({
        data,
        format: "rgba8unorm",
        width,
        height,
        sampler: {
          minFilter: "nearest",
          magFilter: "nearest",
          addressModeU: "clamp-to-edge",
          addressModeV: "clamp-to-edge",
        },
      });
      return {
        module: Colormap,
        props: {
          colormapTexture: cmapTexture,
        },
      };
    }

    case PhotometricInterpretationT.CMYK:
      return {
        module: CMYKToRGB,
      };
    case PhotometricInterpretationT.YCbCr:
      return {
        module: YCbCrToRGB,
      };
    case PhotometricInterpretationT.CIELab:
      return {
        module: cieLabToRGB,
      };
    default:
      throw new Error(
        `Unsupported PhotometricInterpretation ${PhotometricInterpretation}`,
      );
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
