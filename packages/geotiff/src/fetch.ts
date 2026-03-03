import type { SampleFormat, Source, TiffImage } from "@cogeotiff/core";
import { Compression, PlanarConfiguration, TiffTag } from "@cogeotiff/core";
import { compose, translation } from "@developmentseed/affine";
import type { RasterArray } from "./array.js";
import type { ProjJson } from "./crs.js";
import type { DecodedPixels, DecoderMetadata } from "./decode.js";
import { decode } from "./decode.js";
import type { CachedTags } from "./ifd.js";
import type { DecoderPool } from "./pool/pool.js";
import type { Tile } from "./tile";
import type { HasTransform } from "./transform";

/** Protocol for objects that hold a TIFF reference and can request tiles. */
interface HasTiffReference extends HasTransform {
  readonly cachedTags: CachedTags;

  readonly dataSource: Pick<Source, "fetch">;

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
  {
    boundless,
    pool,
    signal,
  }: {
    boundless?: boolean;
    pool?: DecoderPool;
    signal?: AbortSignal;
  } = {},
): Promise<Tile> {
  if (self.maskImage != null) {
    throw new Error("Mask fetching not implemented yet");
  }

  const tile = await fetchCogBytes(self, x, y, { signal });
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

  const decoderMetadata = {
    sampleFormat,
    bitsPerSample,
    samplesPerPixel,
    width: self.tileWidth,
    height: self.tileHeight,
    predictor,
    planarConfiguration,
  };
  const decodedPixels = await decodeTile(tile, decoderMetadata, pool);

  const array: RasterArray = {
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
    array: boundless === false ? clipToImageBounds(self, x, y, array) : array,
  };
}

type GetBytesResponse = { bytes: ArrayBuffer; compression: Compression };
type ByteRange = Awaited<ReturnType<TiffImage["getTileSize"]>>;

async function decodeTile(
  tile: GetBytesResponse | GetBytesResponse[],
  metadata: DecoderMetadata,
  pool: DecoderPool | undefined,
): Promise<DecodedPixels> {
  const decoderFn = (
    bytes: ArrayBuffer,
    compression: Compression,
    meta: DecoderMetadata,
  ): Promise<DecodedPixels> =>
    pool
      ? pool.decode(bytes, compression, meta)
      : decode(bytes, compression, meta);

  if (Array.isArray(tile)) {
    // Band-separate: each element is one band's compressed tile
    const bandMetadata = { ...metadata, samplesPerPixel: 1 };
    const decodedBands = await Promise.all(
      tile.map(({ bytes, compression }) =>
        decoderFn(bytes, compression, bandMetadata),
      ),
    );
    const bands = decodedBands.map((result) =>
      result.layout === "band-separate" ? result.bands[0]! : result.data,
    );
    return { layout: "band-separate", bands };
  } else {
    // Pixel-interleaved: single compressed buffer covering all bands
    // interleaved
    const { bytes, compression } = tile;
    return decoderFn(bytes, compression, metadata);
  }
}

/** Fetch bytes from a COG, handling whether pixel/band interleaving. */
async function fetchCogBytes(
  self: HasTiffReference,
  x: number,
  y: number,
  {
    signal,
  }: {
    signal?: AbortSignal;
  } = {},
): Promise<GetBytesResponse | GetBytesResponse[]> {
  switch (self.cachedTags.planarConfiguration) {
    case PlanarConfiguration.Contig: {
      const tile = await getTile(self.image, x, y, self.dataSource, { signal });
      if (tile === null) {
        throw new Error(`Tile at (${x}, ${y}) not found`);
      }
      return tile;
    }
    case PlanarConfiguration.Separate:
      return await fetchBandSeparateTileBytes(self, x, y, { signal });
    default:
      throw new Error(
        `Unsupported PlanarConfiguration: ${self.cachedTags.planarConfiguration}`,
      );
  }
}

async function findBandSeparateTileByteRanges(
  self: HasTiffReference,
  x: number,
  y: number,
): Promise<ByteRange[]> {
  // TODO: error here if user-provided band-indexes are out of bounds
  const { x: tilesPerRow, y: tilesPerColumn } = self.image.tileCount;
  const tilesPerBand = tilesPerRow * tilesPerColumn;
  const numBands = self.cachedTags.samplesPerPixel;
  const tileSizes = [...Array(numBands).keys()].map((band) => {
    const bandIdx = band * tilesPerBand + y * tilesPerRow + x;
    return self.image.getTileSize(bandIdx);
  });
  return Promise.all(tileSizes);
}

async function fetchBandSeparateTileBytes(
  self: HasTiffReference,
  x: number,
  y: number,
  {
    signal,
  }: {
    signal?: AbortSignal;
  } = {},
): Promise<GetBytesResponse[]> {
  const byteRanges = await findBandSeparateTileByteRanges(self, x, y);
  const buffers = byteRanges.map(async ({ offset, imageSize }) => {
    const tile = await getBytes(
      self.image,
      offset,
      imageSize,
      self.dataSource,
      { signal },
    );
    if (tile === null) {
      throw new Error(`Tile at (${x}, ${y}) not found`);
    }
    return tile;
  });
  return Promise.all(buffers);
}

/**
 * Load a tile into a ArrayBuffer
 *
 * if the tile compression is JPEG, This will also apply the JPEG compression tables to the resulting ArrayBuffer see {@link getJpegHeader}
 *
 * Though this function lives upstream in @cogeotiff/core, we vendor it here so
 * that we can use a custom fetch.
 *
 * This is to separate the source used for fetching header/IFD data (which is
 * typically small and benefits from caching) from the source used for fetching
 * tile data (which can be large and should avoid unnecessary copying through
 * cache layers).
 */
async function getTile(
  image: TiffImage,
  x: number,
  y: number,
  source: Pick<Source, "fetch">,
  options?: { signal?: AbortSignal },
): Promise<{
  bytes: ArrayBuffer;
  compression: Compression;
} | null> {
  const { size, tileSize: tiles } = image;

  if (tiles == null) throw new Error("Tiff is not tiled");

  // TODO support GhostOptionTileOrder
  const nyTiles = Math.ceil(size.height / tiles.height);
  const nxTiles = Math.ceil(size.width / tiles.width);

  if (x >= nxTiles || y >= nyTiles) {
    throw new Error(
      `Tile index is outside of range x:${x} >= ${nxTiles} or y:${y} >= ${nyTiles}`,
    );
  }

  const idx = y * nxTiles + x;
  const totalTiles = nxTiles * nyTiles;
  if (idx >= totalTiles)
    throw new Error(
      `Tile index is outside of tile range: ${idx} >= ${totalTiles}`,
    );

  const { offset, imageSize } = await image.getTileSize(idx);

  return getBytes(image, offset, imageSize, source, options);
}

/** Read image bytes at the given offset.
 *
 * Though this function lives upstream in @cogeotiff/core, we vendor it here so
 * that we can use a custom fetch.
 *
 * This is to separate the source used for fetching header/IFD data (which is
 * typically small and benefits from caching) from the source used for fetching
 * tile data (which can be large and should avoid unnecessary copying through
 * cache layers).
 */
async function getBytes(
  image: TiffImage,
  offset: number,
  byteCount: number,
  source: Pick<Source, "fetch">,
  options?: { signal?: AbortSignal },
): Promise<{
  bytes: ArrayBuffer;
  compression: Compression;
} | null> {
  if (byteCount === 0) return null;

  const bytes = await source.fetch(offset, byteCount, options);
  if (bytes.byteLength < byteCount) {
    throw new Error(
      `Failed to fetch bytes from offset:${offset} wanted:${byteCount} got:${bytes.byteLength}`,
    );
  }

  const compression = image.value(TiffTag.Compression) ?? Compression.None;
  if (compression === Compression.Jpeg) {
    return {
      bytes: image.getJpegHeader(bytes),
      compression,
    };
  }
  return { bytes, compression };
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
