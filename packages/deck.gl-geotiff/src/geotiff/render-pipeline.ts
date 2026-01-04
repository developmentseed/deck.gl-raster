import type { RasterModule } from "@developmentseed/deck.gl-raster/gpu-modules";
import {
  CMYKToRGB,
  CreateTexture,
  cieLabToRGB,
  FilterNoDataVal,
  YCbCrToRGB,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Texture } from "@luma.gl/core";
import type { GeoTIFFImage, TypedArrayWithDimensions } from "geotiff";
import { globals } from "geotiff";
import type { COGLayerProps, GetTileDataOptions } from "../cog-layer";
import { addAlphaChannel } from "./geotiff";
import { inferTextureFormat } from "./texture";

type GeoTIFFMetadata = {
  BitsPerSample: Uint16Array;
  GDAL_NODATA?: string;
  PhotometricInterpretation: number;
  SampleFormat: Uint16Array;
  /** Number of bands */
  SamplesPerPixel: number;
};

export type TextureDataT = {
  height: number;
  width: number;
  texture: Texture;
};

export function inferRenderPipeline(options: GeoTIFFMetadata): {
  getTileData: COGLayerProps<TextureDataT>["getTileData"];
  renderTile: COGLayerProps<TextureDataT>["renderTile"];
} {
  const {
    BitsPerSample,
    SamplesPerPixel,
    SampleFormat,
    PhotometricInterpretation,
  } = options;

  switch (SamplesPerPixel) {
    case 3:
      return createRGB8Pipeline(options);
  }

  throw new Error("todo");
}

/** Create a pipeline for visualizing 8-bit RGB imagery. */
function createRGB8Pipeline(options: GeoTIFFMetadata): {
  getTileData: COGLayerProps<TextureDataT>["getTileData"];
  renderTile: COGLayerProps<TextureDataT>["renderTile"];
} {
  const {
    BitsPerSample,
    GDAL_NODATA,
    PhotometricInterpretation,
    SampleFormat,
    SamplesPerPixel,
  } = options;

  const renderPipeline: RasterModule[] = [
    {
      module: CreateTexture,
      props: {},
    },
  ];

  // Add NoData filtering if GDAL_NODATA is defined
  // Remove trailing null character if present
  const noDataString =
    GDAL_NODATA?.[GDAL_NODATA?.length - 1] === "\x00"
      ? GDAL_NODATA.slice(0, -1)
      : GDAL_NODATA;
  const noDataVal =
    noDataString && noDataString?.length > 0 ? parseInt(noDataString) : null;
  if (noDataVal !== null) {
    // Since values are 0-1 for unorm textures,
    const noDataScaled = noDataVal / 255.0;

    renderPipeline.push({
      module: FilterNoDataVal,
      props: { value: noDataScaled },
    });
  }

  const rgbModule = photometricInterpretationToRGB(PhotometricInterpretation);
  if (rgbModule) {
    renderPipeline.push(rgbModule);
  }

  const getTileData: COGLayerProps<TextureDataT>["getTileData"] = async (
    image: GeoTIFFImage,
    options: GetTileDataOptions,
  ) => {
    const { device } = options;
    const mergedOptions = {
      ...options,
      interleave: true,
    };

    const data = (await image.readRasters(
      mergedOptions,
    )) as TypedArrayWithDimensions;

    // WebGL2 doesn't have an RGB texture format
    const rgbaData = addAlphaChannel(data);

    const textureFormat = inferTextureFormat(
      // Add one sample for added alpha channel
      SamplesPerPixel + 1,
      BitsPerSample,
      SampleFormat,
    );
    const texture = device.createTexture({
      data: rgbaData,
      dimension: "2d",
      format: textureFormat,
      width: data.width,
      height: data.height,
      sampler: {
        magFilter: "linear",
        minFilter: "linear",
      },
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

    // We need to edit the pipeline to provide the texture from this tile.
    //
    // We can't clone the pipeline because it holds function callbacks in the
    // raster modules. Instead, we jus
    const pipeline = [...renderPipeline];
    pipeline[0] = {
      module: CreateTexture,
      props: { textureName: texture },
    };

    return pipeline;
  };

  return { getTileData, renderTile };
}

function photometricInterpretationToRGB(
  PhotometricInterpretation: number,
): RasterModule | null {
  switch (PhotometricInterpretation) {
    case globals.photometricInterpretations.RGB:
      return null;
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
