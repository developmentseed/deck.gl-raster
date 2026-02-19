import { Photometric, SampleFormat } from "@cogeotiff/core";
import type { RasterModule } from "@developmentseed/deck.gl-raster/gpu-modules";
import {
  CMYKToRGB,
  Colormap,
  CreateTexture,
  cieLabToRGB,
  FilterNoDataVal,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Device, SamplerProps, Texture } from "@luma.gl/core";
import type { COGLayerProps, GetTileDataOptions } from "../cog-layer";
import { addAlphaChannel, parseColormap } from "./geotiff";
import { inferTextureFormat } from "./texture";

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
  geotiff: GeoTIFF,
  device: Device,
): {
  getTileData: COGLayerProps<TextureDataT>["getTileData"];
  renderTile: COGLayerProps<TextureDataT>["renderTile"];
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
    `Inferring render pipeline for non-unsigned integers not yet supported. Found SampleFormat: ${SampleFormat}`,
  );
}

/**
 * Create pipeline for visualizing unsigned-integer data.
 */
function createUnormPipeline(
  geotiff: GeoTIFF,
  device: Device,
): {
  getTileData: COGLayerProps<TextureDataT>["getTileData"];
  renderTile: COGLayerProps<TextureDataT>["renderTile"];
} {
  const tags = geotiff.cachedTags;
  const {
    bitsPerSample,
    colorMap,
    photometric,
    sampleFormat,
    samplesPerPixel,
    nodata,
  } = tags;

  const renderPipeline: UnresolvedRasterModule<TextureDataT>[] = [
    {
      module: CreateTexture,
      props: {
        textureName: (data: TextureDataT) => data.texture,
      },
    },
  ];

  if (nodata !== null) {
    // Since values are 0-1 for unorm textures,
    const noDataScaled = nodata / 255.0;

    renderPipeline.push({
      module: FilterNoDataVal,
      props: { value: noDataScaled },
    });
  }

  const toRGBModule = photometricInterpretationToRGB(
    photometric,
    device,
    colorMap,
  );
  if (toRGBModule) {
    renderPipeline.push(toRGBModule);
  }

  // For palette images, use nearest-neighbor sampling
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

  const getTileData: COGLayerProps<TextureDataT>["getTileData"] = async (
    image: GeoTIFF | Overview,
    options: GetTileDataOptions,
  ) => {
    const { device, x, y, signal } = options;
    const tile = await image.fetchTile(x, y, { signal, boundless: false });
    let { array } = tile;

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
    const texture = device.createTexture({
      data: array.data,
      format: textureFormat,
      width: array.width,
      height: array.height,
      sampler: samplerOptions,
    });

    return {
      texture,
      height: array.height,
      width: array.width,
    };
  };
  const renderTile: COGLayerProps<TextureDataT>["renderTile"] = (
    tileData: TextureDataT,
  ): RasterModule[] => {
    return renderPipeline.map((m, _i) => resolveModule(m, tileData));
  };

  return { getTileData, renderTile };
}

function photometricInterpretationToRGB(
  photometric: Photometric,
  device: Device,
  ColorMap?: Uint16Array,
): RasterModule | null {
  switch (photometric) {
    case Photometric.Rgb:
      return null;
    case Photometric.Palette: {
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
