import type { TextureFormat, TextureProps } from "@luma.gl/core";
import type { GeoTIFFImage, TypedArray } from "geotiff";
import type { ImageFileDirectory } from "./types";

/**
 * Infers texture properties from a GeoTIFF image and its associated data.
 */
export function createTextureProps(
  image: GeoTIFFImage,
  data: TypedArray,
  options: { width: number; height: number },
): TextureProps {
  const ifd = image.getFileDirectory() as ImageFileDirectory;
  const samplesPerPixel = ifd.SamplesPerPixel;

  const textureFormat = inferTextureFormat(
    samplesPerPixel,
    ifd.BitsPerSample,
    ifd.SampleFormat,
  );

  return {
    data,
    format: textureFormat,
    width: options.width,
    height: options.height,
  };
}

/**
 * Infer the TextureFormat given values from GeoTIFF tags.
 */
export function inferTextureFormat(
  samplesPerPixel: number,
  bitsPerSample: Uint16Array,
  sampleFormat: Uint16Array,
): TextureFormat {
  const channelCount = verifySamplesPerPixel(samplesPerPixel);
  const bitWidth = verifyIdenticalBitsPerSample(bitsPerSample);
  const scalarKind = inferScalarKind(sampleFormat);

  const formatKey: TextureFormatKey = `${channelCount}:${scalarKind}:${bitWidth}`;

  const format = FORMAT_TABLE[formatKey];
  if (!format) {
    throw new Error(
      `Unsupported texture format for SamplesPerPixel=${samplesPerPixel}, BitsPerSample=${bitsPerSample}, SampleFormat=${sampleFormat}`,
    );
  }

  return format;
}

type ScalarKind = "uint" | "unorm" | "sint" | "float";
type ChannelCount = 1 | 2 | 3 | 4;
type BitWidth = 8 | 16 | 32;

function verifySamplesPerPixel(samplesPerPixel: number): ChannelCount {
  if (
    samplesPerPixel === 1 ||
    samplesPerPixel === 2 ||
    samplesPerPixel === 3 ||
    samplesPerPixel === 4
  ) {
    return samplesPerPixel;
  }

  throw new Error(
    `Unsupported SamplesPerPixel ${samplesPerPixel}. Only 1, 2, 3, or 4 are supported.`,
  );
}

export function verifyIdenticalBitsPerSample(
  bitsPerSample: Uint16Array,
): BitWidth {
  // bitsPerSamples is non-empty
  const first = bitsPerSample[0]!;

  for (let i = 1; i < bitsPerSample.length; i++) {
    if (bitsPerSample[i] !== first) {
      throw new Error(
        `Unsupported varying BitsPerSample ${bitsPerSample}. All samples must have the same bit width.`,
      );
    }
  }

  if (first !== 8 && first !== 16 && first !== 32) {
    throw new Error(
      `Unsupported BitsPerSample ${first}. Only 8, 16, or 32 are supported.`,
    );
  }

  return first;
}

/**
 * Map the geotiff tag SampleFormat to known kinds of scalars
 */
function inferScalarKind(sampleFormat: Uint16Array): ScalarKind {
  // Only support identical SampleFormats for all samples
  const first = sampleFormat[0]!;

  for (let i = 1; i < sampleFormat.length; i++) {
    if (sampleFormat[i] !== first) {
      throw new Error(
        `Unsupported varying SampleFormat ${sampleFormat}. All samples must have the same format.`,
      );
    }
  }

  switch (first) {
    case 1:
      return "unorm";
    case 2:
      return "sint";
    case 3:
      return "float";
    default:
      throw new Error(`Unsupported SampleFormat ${sampleFormat}`);
  }
}

type TextureFormatKey = `${ChannelCount}:${ScalarKind}:${BitWidth}`;

/**
 * A mapping of our texture format "key" to allowed TextureFormats defined by
 * luma.gl.
 *
 * See https://luma.gl/docs/api-reference/core/texture-formats for details on
 * texture formats.
 *
 * You can use `device.isTextureFormatSupported(format)` check if it is possible
 * to create and sample textures with a specific texture format on your current
 * device.
 *
 * This explicit mapping ensures that Typescript can verify that all keys
 * correspond to valid TextureFormats.
 */
const FORMAT_TABLE: Partial<Record<TextureFormatKey, TextureFormat>> = {
  // 1 byte per pixel
  "1:sint:8": "r8sint",
  "1:uint:8": "r8uint",
  "1:unorm:8": "r8unorm",

  // 2 bytes per pixel (one channel)
  "1:float:16": "r16float",
  "1:sint:16": "r16sint",
  "1:uint:16": "r16uint",
  "1:unorm:16": "r16unorm",

  // 2 bytes per pixel (two channels)
  "2:sint:8": "rg8sint",
  "2:uint:8": "rg8uint",
  "2:unorm:8": "rg8unorm",

  // 4 bytes per pixel (one channel)
  "1:float:32": "r32float",
  "1:sint:32": "r32sint",
  "1:uint:32": "r32uint",

  // 4 bytes per pixel (two channels)
  "2:float:16": "rg16float",
  "2:sint:16": "rg16sint",
  "2:uint:16": "rg16uint",
  "2:unorm:16": "rg16unorm",

  // 4 bytes per pixel (four channels)
  "4:sint:8": "rgba8sint",
  "4:uint:8": "rgba8uint",
  "4:unorm:8": "rgba8unorm",

  // 6 bytes per pixel (three channels)
  // Note: this is supported on WebGL2 but not supported on WebGPU
  // I expect actual switch to WebGPU to be quite a ways off still
  "3:uint:16": "rgb16unorm-webgl",

  // 8 bytes per pixel (two channels)
  "2:float:32": "rg32float",
  "2:sint:32": "rg32sint",
  "2:uint:32": "rg32uint",

  // 8 bytes per pixel (four channels)
  "4:float:16": "rgba16float",
  "4:sint:16": "rgba16sint",
  "4:uint:16": "rgba16uint",
  "4:unorm:16": "rgba16unorm",

  // 12 bytes per pixel (three channels)
  "3:float:32": "rgb32float-webgl",

  // 16 bytes per pixel (four channels)
  "4:float:32": "rgba32float",
  "4:sint:32": "rgba32sint",
  "4:uint:32": "rgba32uint",
};
