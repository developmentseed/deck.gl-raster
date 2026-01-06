import type { RasterModule } from "@developmentseed/deck.gl-raster/gpu-modules";
import {
  CMYKToRGB,
  Colormap,
  CreateTexture,
  cieLabToRGB,
  FilterNoDataVal,
  YCbCrToRGB,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Device, SamplerProps, Texture } from "@luma.gl/core";
import type { GeoTIFFImage, TypedArrayWithDimensions } from "geotiff";
import { globals } from "geotiff";
import type { COGLayerProps, GetTileDataOptions } from "../cog-layer";
import { addAlphaChannel, parseColormap, parseGDALNoData } from "./geotiff";
import { inferTextureFormat } from "./texture";
import type { ImageFileDirectory } from "./types";

export type TextureDataT = {
  height: number;
  width: number;
  texture: Texture;
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

  // Texture initialization will be injected inside of renderTile, once the
  // tile's data has loaded.
  const renderPipeline: RasterModule[] = [];

  // Add NoData filtering if GDAL_NODATA is defined
  const noDataVal = parseGDALNoData(GDAL_NODATA);
  if (noDataVal !== null) {
    // Since values are 0-1 for unorm textures,
    const noDataScaled = noDataVal / 255.0;

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
    PhotometricInterpretation === globals.photometricInterpretations.Palette
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
    const { texture } = tileData;
    return [
      {
        module: CreateTexture,
        props: { textureName: texture },
      },
      ...renderPipeline,
    ];
  };

  return { getTileData, renderTile };
}

function photometricInterpretationToRGB(
  PhotometricInterpretation: number,
  device: Device,
  ColorMap?: Uint16Array,
): RasterModule | null {
  switch (PhotometricInterpretation) {
    case globals.photometricInterpretations.RGB:
      return null;
    case globals.photometricInterpretations.Palette: {
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

    case globals.photometricInterpretations.CMYK:
      return {
        module: CMYKToRGB,
      };
    case globals.photometricInterpretations.YCbCr:
      return {
        module: YCbCrToRGB,
      };
    case globals.photometricInterpretations.CIELab:
      return {
        module: cieLabToRGB,
      };
    default:
      throw new Error(
        `Unsupported PhotometricInterpretation ${PhotometricInterpretation}`,
      );
  }
}
