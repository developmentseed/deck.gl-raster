import type { SampleFormat, TiffImage } from "@cogeotiff/core";
import { PlanarConfiguration, TiffTag } from "@cogeotiff/core";
import { compose, translation } from "@developmentseed/affine";
import type { RasterArray, RasterTypedArray } from "./array.js";
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
  options: { boundless?: boolean; signal?: AbortSignal } = {},
): Promise<Tile> {
  if (self.maskImage != null) {
    throw new Error("Mask fetching not implemented yet");
  }

  const {
    bitsPerSample: bitsPerSamples,
    predictor,
    planarConfiguration,
    sampleFormat: sampleFormats,
  } = self.cachedTags;
  const { sampleFormat, bitsPerSample } = getUniqueSampleFormat(
    sampleFormats,
    bitsPerSamples,
  );

  const tileTransform = compose(
    self.transform,
    translation(x * self.tileWidth, y * self.tileHeight),
  );

  const samplesPerPixel = self.image.value(TiffTag.SamplesPerPixel) ?? 1;

  let array: RasterArray;

  if (
    planarConfiguration === PlanarConfiguration.Separate &&
    samplesPerPixel > 1
  ) {
    array = await fetchBandSeparateTile(self, x, y, {
      sampleFormat,
      bitsPerSample,
      samplesPerPixel,
      predictor,
      planarConfiguration,
      tileTransform,
      signal: options.signal,
    });
  } else {
    const tile = await self.image.getTile(x, y, options);
    if (tile === null) {
      throw new Error("Tile not found");
    }

    const { bytes, compression } = tile;
    const decodedPixels = await decode(bytes, compression, {
      sampleFormat,
      bitsPerSample,
      samplesPerPixel,
      width: self.tileWidth,
      height: self.tileHeight,
      predictor,
      planarConfiguration,
    });

    array = {
      ...decodedPixels,
      count: samplesPerPixel,
      height: self.tileHeight,
      width: self.tileWidth,
      mask: null,
      transform: tileTransform,
      crs: self.crs,
      nodata: self.nodata,
    };
  }

  return {
    x,
    y,
    array:
      options.boundless === false
        ? clipToImageBounds(self, x, y, array)
        : array,
  };
}

async function fetchBandSeparateTile(
  self: HasTiffReference,
  x: number,
  y: number,
  opts: {
    sampleFormat: SampleFormat;
    bitsPerSample: number;
    samplesPerPixel: number;
    predictor: CachedTags["predictor"];
    planarConfiguration: CachedTags["planarConfiguration"];
    tileTransform: RasterArray["transform"];
    signal?: AbortSignal;
  },
): Promise<RasterArray> {
  const { samplesPerPixel, planarConfiguration } = opts;
  const nxTiles = self.image.tileCount.x;
  const nyTiles = self.image.tileCount.y;
  const tilesPerBand = nxTiles * nyTiles;
  const baseTileIndex = y * nxTiles + x;

  const bandPromises: Promise<RasterTypedArray>[] = [];
  for (let b = 0; b < samplesPerPixel; b++) {
    const tileIndex = b * tilesPerBand + baseTileIndex;
    bandPromises.push(
      self.image.getTileSize(tileIndex).then(async ({ offset, imageSize }) => {
        const result = await self.image.getBytes(offset, imageSize, {
          signal: opts.signal,
        });
        if (result === null) {
          throw new Error(`Band ${b} tile not found at index ${tileIndex}`);
        }
        const decoded = await decode(result.bytes, result.compression, {
          sampleFormat: opts.sampleFormat,
          bitsPerSample: opts.bitsPerSample,
          samplesPerPixel: 1,
          width: self.tileWidth,
          height: self.tileHeight,
          predictor: opts.predictor,
          planarConfiguration,
        });
        if (decoded.layout === "band-separate") {
          return decoded.bands[0]!;
        }
        return decoded.data;
      }),
    );
  }

  const bands = await Promise.all(bandPromises);

  return {
    layout: "band-separate",
    bands,
    count: samplesPerPixel,
    height: self.tileHeight,
    width: self.tileWidth,
    mask: null,
    transform: opts.tileTransform,
    crs: self.crs,
    nodata: self.nodata,
  };
}

/**
 * Clip a decoded tile array to the valid image bounds.
 *
 * Edge tiles in a COG are always encoded at the full tile size, with the
 * out-of-bounds region zero-padded. When `boundless=false` is requested, this
 * function copies only the valid pixel sub-rectangle into a new typed array,
 * returning a `RasterArray` whose `width`/`height` match the actual image
 * content rather than the tile dimensions.
 *
 * Interior tiles (where the tile fits entirely within the image) are returned
 * unchanged.
 */
function clipToImageBounds(
  self: HasTiffReference,
  x: number,
  y: number,
  array: RasterArray,
): RasterArray {
  const { width: clippedWidth, height: clippedHeight } =
    self.image.getTileBounds(x, y);

  // Interior tile — nothing to clip.
  if (clippedWidth === self.tileWidth && clippedHeight === self.tileHeight) {
    return array;
  }

  if (array.layout === "pixel-interleaved") {
    const { count, data } = array;
    const Ctor = data.constructor as new (n: number) => typeof data;
    const clipped = new Ctor(clippedWidth * clippedHeight * count);
    for (let r = 0; r < clippedHeight; r++) {
      const srcOffset = r * self.tileWidth * count;
      const dstOffset = r * clippedWidth * count;
      clipped.set(
        data.subarray(srcOffset, srcOffset + clippedWidth * count),
        dstOffset,
      );
    }
    return {
      ...array,
      width: clippedWidth,
      height: clippedHeight,
      data: clipped,
    };
  }

  // band-separate
  const { bands } = array;
  const Ctor = bands[0]!.constructor as new (
    n: number,
  ) => (typeof bands)[number];
  const clippedBands = bands.map((band) => {
    const clipped = new Ctor(clippedWidth * clippedHeight);
    for (let r = 0; r < clippedHeight; r++) {
      const srcOffset = r * self.tileWidth;
      const dstOffset = r * clippedWidth;
      clipped.set(
        band.subarray(srcOffset, srcOffset + clippedWidth),
        dstOffset,
      );
    }
    return clipped;
  });

  return {
    ...array,
    width: clippedWidth,
    height: clippedHeight,
    bands: clippedBands,
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
