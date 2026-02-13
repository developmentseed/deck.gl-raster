import type { SampleFormat, Tiff, TiffImage } from "@cogeotiff/core";
import { TiffTag } from "@cogeotiff/core";
import { compose, translation } from "@developmentseed/affine";
import { decode } from "./decode/api";
import type { Tile } from "./tile";
import type { HasTransform } from "./transform";

/** Protocol for objects that hold a TIFF reference and can request tiles. */
interface HasTiffReference extends HasTransform {
  /** The data Image File Directory (IFD) */
  ifd: TiffImage;

  /** The mask Image File Directory (IFD), if any. */
  maskIfd: TiffImage | null;

  /** The underlying TIFF object. */
  tiff: Tiff;

  /** The coordinate reference system. */
  crs: string;

  /** The height of tiles in pixels. */
  tileHeight: number;

  /** The width of tiles in pixels. */
  tileWidth: number;

  /** The nodata value for the image, if any. */
  nodata: number | null;
}

export async function fetchTile(
  self: HasTiffReference,
  x: number,
  y: number,
): Promise<Tile> {
  if (self.maskIfd != null) {
    throw new Error("Mask fetching not implemented yet");
  }

  const tile = await self.ifd.getTile(x, y);
  if (tile === null) {
    throw new Error("Tile not found");
  }

  const { bytes, compression } = tile;
  const sampleFormats = await self.ifd.fetch(TiffTag.SampleFormat);
  const bitsPerSamples = await self.ifd.fetch(TiffTag.BitsPerSample);
  const { sampleFormat, bitsPerSample } = getUniqueSampleFormat(
    sampleFormats,
    bitsPerSamples,
  );

  const tileTransform = compose(
    self.transform,
    translation(x * self.tileWidth, y * self.tileHeight),
  );

  const decodedPixels = await decode(bytes, compression, {
    sampleFormat,
    bitsPerSample,
  });

  if (decodedPixels.layout === "band-separate") {
  }

  const array = {
    ...decodedPixels,
    // https://github.com/blacha/cogeotiff/pull/1394
    count: self.ifd.value(TiffTag.SamplesPerPixel) as number,
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
  sampleFormats: SampleFormat[] | null,
  bitsPerSamples: number[] | null,
): { sampleFormat: SampleFormat; bitsPerSample: number } {
  if (sampleFormats === null || bitsPerSamples === null) {
    throw new Error(
      "SampleFormat and BitsPerSample should always exist in TIFF.",
    );
  }

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
