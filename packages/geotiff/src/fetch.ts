import type { SampleFormat, Source, TiffImage } from "@cogeotiff/core";
import { Compression, PlanarConfiguration, TiffTag } from "@cogeotiff/core";
import { compose, translation } from "@developmentseed/affine";
import type { ProjJson } from "@developmentseed/proj";
import type { RasterArray } from "./array.js";
import type { DecodedPixels, DecoderMetadata } from "./decode.js";
import { decode } from "./decode.js";
import type { CachedTags } from "./ifd.js";
import type { DecoderPool } from "./pool/pool.js";
import type { Tile } from "./tile.js";
import type { HasTransform } from "./transform.js";

/** Protocol for objects that hold a TIFF reference and can request tiles. */
interface HasTiffReference extends HasTransform {
  readonly cachedTags: CachedTags;

  /** The data source used for fetching tile data. */
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
    boundless = true,
    pool,
    signal,
  }: {
    boundless?: boolean;
    pool?: DecoderPool;
    signal?: AbortSignal;
  } = {},
): Promise<Tile> {
  const tileFetch = fetchCogBytes(self, x, y, { signal });
  const maskFetch =
    self.maskImage != null
      ? getTile(self.maskImage, x, y, self.dataSource, { signal })
      : Promise.resolve(null);

  const [tileBytes, maskBytes] = await Promise.all([tileFetch, maskFetch]);

  const {
    bitsPerSample: bitsPerSamples,
    predictor,
    planarConfiguration,
    sampleFormat: sampleFormats,
    lercParameters,
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
    lercParameters,
  };
  const [decodedPixels, mask] = await Promise.all([
    decodeTile(tileBytes, decoderMetadata, pool),
    maskBytes != null && self.maskImage != null
      ? decodeMask(maskBytes, self.maskImage, pool)
      : Promise.resolve(null),
  ]);

  const array: RasterArray = {
    ...decodedPixels,
    count: samplesPerPixel,
    height: self.tileHeight,
    width: self.tileWidth,
    mask,
    transform: tileTransform,
    crs: self.crs,
    nodata: self.nodata,
  };

  return {
    x,
    y,
    array: boundless === true ? array : clipToImageBounds(self, x, y, array),
  };
}

/**
 * Fetch multiple tiles from a GeoTIFF or Overview in parallel.
 *
 * The benefit of using this over multiple calls to {@link fetchTile} is that
 * a future implementation can coalesce requests for tiles stored contiguously
 * on disk, reducing the number of HTTP range requests. For now, this simply
 * calls {@link fetchTile} in parallel for each coordinate.
 *
 * @param self - The GeoTIFF or Overview to fetch tiles from.
 * @param xy - Array of `[x, y]` tile coordinates.
 * @param options - Optional parameters (same as {@link fetchTile}).
 * @returns Array of {@link Tile} objects in the same order as `xy`.
 *
 * @see {@link fetchTile} for single-tile fetching.
 */
export async function fetchTiles(
  self: HasTiffReference,
  xy: Array<[number, number]>,
  {
    boundless = true,
    pool,
    signal,
  }: {
    boundless?: boolean;
    pool?: DecoderPool;
    signal?: AbortSignal;
  } = {},
): Promise<Tile[]> {
  // TODO: coalesce contiguous byte ranges for fewer HTTP requests
  return Promise.all(
    xy.map(([x, y]) => fetchTile(self, x, y, { boundless, pool, signal })),
  );
}

type GetBytesResponse = { bytes: ArrayBuffer; compression: Compression };
type ByteRange = Awaited<ReturnType<TiffImage["getTileSize"]>>;

async function decodeMask(
  mask: GetBytesResponse,
  maskImage: TiffImage,
  pool: DecoderPool | undefined,
): Promise<Uint8Array> {
  const maskSampleFormats = maskImage.value(TiffTag.SampleFormat) ?? [1];
  const maskBitsPerSample = maskImage.value(TiffTag.BitsPerSample) ?? [8];
  const { sampleFormat, bitsPerSample } = getUniqueSampleFormat(
    maskSampleFormats as SampleFormat[],
    new Uint16Array(maskBitsPerSample as number[]),
  );
  const { width, height } = maskImage.tileSize;
  const metadata: DecoderMetadata = {
    sampleFormat,
    bitsPerSample,
    samplesPerPixel: maskImage.value(TiffTag.SamplesPerPixel) ?? 1,
    width,
    height,
    predictor: maskImage.value(TiffTag.Predictor) ?? 1,
    planarConfiguration:
      maskImage.value(TiffTag.PlanarConfiguration) ??
      PlanarConfiguration.Contig,
  };

  const decoderFn = (
    bytes: ArrayBuffer,
    compression: Compression,
    meta: DecoderMetadata,
  ): Promise<DecodedPixels> =>
    pool
      ? pool.decode(bytes, compression, meta)
      : decode(bytes, compression, meta);

  const { bytes, compression } = mask;
  const decoded = await decoderFn(bytes, compression, metadata);
  const data =
    decoded.layout === "pixel-interleaved" ? decoded.data : decoded.bands[0]!;
  if (data instanceof Uint8Array) {
    return data;
  }
  throw new Error("Expected mask data to decode to Uint8Array");
}

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

  if (tiles == null) {
    throw new Error("Tiff is not tiled");
  }

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
  if (idx >= totalTiles) {
    throw new Error(
      `Tile index is outside of tile range: ${idx} >= ${totalTiles}`,
    );
  }

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
  if (byteCount === 0) {
    return null;
  }

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

  const clippedMask = array.mask
    ? clipRows(array.mask, self.tileWidth, clippedWidth, clippedHeight, 1)
    : array.mask;

  if (array.layout === "pixel-interleaved") {
    const { count, data } = array;
    const clipped = clipRows(
      data,
      self.tileWidth,
      clippedWidth,
      clippedHeight,
      count,
    );
    return {
      ...array,
      width: clippedWidth,
      height: clippedHeight,
      data: clipped as typeof data,
      mask: clippedMask,
    };
  }

  // band-separate
  const { bands } = array;
  const clippedBands = bands.map(
    (band) =>
      clipRows(
        band,
        self.tileWidth,
        clippedWidth,
        clippedHeight,
        1,
      ) as typeof band,
  );

  return {
    ...array,
    width: clippedWidth,
    height: clippedHeight,
    bands: clippedBands,
    mask: clippedMask,
  };
}

/**
 * Copy rows from a strided typed array, keeping only `clippedWidth * samplesPerPixel`
 * values per row out of `tileWidth * samplesPerPixel`.
 */
function clipRows<
  T extends {
    subarray(s: number, e: number): T;
    set(src: T, offset: number): void;
  },
>(
  src: T,
  tileWidth: number,
  clippedWidth: number,
  clippedHeight: number,
  samplesPerPixel: number,
): T {
  const srcStride = tileWidth * samplesPerPixel;
  const dstStride = clippedWidth * samplesPerPixel;
  // @ts-expect-error — typed array constructors are not in a common interface
  const dst: T = new src.constructor(dstStride * clippedHeight);
  for (let r = 0; r < clippedHeight; r++) {
    dst.set(
      src.subarray(r * srcStride, r * srcStride + dstStride),
      r * dstStride,
    );
  }
  return dst;
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
