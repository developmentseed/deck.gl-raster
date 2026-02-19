import type { SampleFormat, TiffImage } from "@cogeotiff/core";
import { TiffTag } from "@cogeotiff/core";
import { compose, translation } from "@developmentseed/affine";
import type { ProjJson } from "./crs.js";
import { decode } from "./decode.js";
import type { CachedTags } from "./ifd.js";
import type { Tile } from "./tile";
import type { HasTransform } from "./transform";

/** Protocol for objects that hold a TIFF reference and can request tiles. */
interface HasTiffReference extends HasTransform {
  readonly cachedTags: CachedTags;

  /** The data Image File Directory (IFD) */
  readonly image: TiffImage;

  /** The mask Image File Directory (IFD), if any. */
  readonly maskImage: TiffImage | null;

  /** The coordinate reference system. */
  readonly crs: number | ProjJson;

  /** The height of tiles in pixels. */
  readonly tileHeight: number;

  /** The width of tiles in pixels. */
  readonly tileWidth: number;

  /** The nodata value for the image, if any. */
  readonly nodata: number | null;
}

export async function fetchTile(
  self: HasTiffReference,
  x: number,
  y: number,
  options: { signal?: AbortSignal } = {},
): Promise<Tile> {
  if (self.maskImage != null) {
    throw new Error("Mask fetching not implemented yet");
  }

  const tile = await self.image.getTile(x, y, options);
  if (tile === null) {
    throw new Error("Tile not found");
  }

  const {
    bitsPerSample: bitsPerSamples,
    predictor,
    planarConfiguration,
    sampleFormat: sampleFormats,
  } = self.cachedTags;
  const { bytes, compression } = tile;
  const { sampleFormat, bitsPerSample } = getUniqueSampleFormat(
    sampleFormats,
    bitsPerSamples,
  );

  const tileTransform = compose(
    self.transform,
    translation(x * self.tileWidth, y * self.tileHeight),
  );

  const samplesPerPixel = self.image.value(TiffTag.SamplesPerPixel) ?? 1;

  const decodedPixels = await decode(bytes, compression, {
    sampleFormat,
    bitsPerSample,
    samplesPerPixel,
    width: self.tileWidth,
    height: self.tileHeight,
    predictor,
    planarConfiguration,
  });

  const array = {
    ...decodedPixels,
    count: samplesPerPixel,
    height: self.tileHeight,
    width: self.tileWidth,
    mask: null,
    transform: tileTransform,
    crs: self.crs,
    nodata: self.nodata,
  };

  return {
    x,
    y,
    array,
  };
}

function getUniqueSampleFormat(
  sampleFormats: SampleFormat[],
  bitsPerSamples: Uint16Array,
): { sampleFormat: SampleFormat; bitsPerSample: number } {
  const uniqueSampleFormats = new Set(sampleFormats);
  const uniqueBitsPerSample = new Set(bitsPerSamples);

  if (uniqueSampleFormats.size > 1) {
    throw new Error("Multiple sample formats are not supported.");
  }
  if (uniqueBitsPerSample.size > 1) {
    throw new Error("Multiple bits per sample values are not supported.");
  }
  const sampleFormat = sampleFormats[0];
  const bitsPerSample = bitsPerSamples[0];

  if (sampleFormat === undefined || bitsPerSample === undefined) {
    throw new Error("SampleFormat and BitsPerSample arrays cannot be empty.");
  }

  return {
    sampleFormat,
    bitsPerSample,
  };
}
