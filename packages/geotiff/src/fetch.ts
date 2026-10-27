import type { SampleFormat, Source, TiffImage } from "@cogeotiff/core";
import { Compression, PlanarConfiguration, TiffTag } from "@cogeotiff/core";
import { compose, translation } from "@developmentseed/affine";
import type { ProjJson } from "@developmentseed/proj";
import type { RasterArray } from "./array.js";
import type { DecodedPixels, DecoderMetadata } from "./decode.js";
import { decode } from "./decode.js";
import type { CachedPrimaryImageTags, CachedSubImageTags } from "./ifd.js";
import type { DecoderPool } from "./pool/pool.js";
import type { Tile } from "./tile.js";
import type { HasTransform } from "./transform.js";

/** Protocol for objects that hold a TIFF reference and can request tiles. */
interface HasTiffReference extends HasTransform {
  /** Tags of the file's primary image, which generally apply to every overview too. */
  readonly cachedPrimaryImageTags: CachedPrimaryImageTags;

  /** The data source used for fetching tile data. */
  readonly dataSource: Pick<Source, "fetch">;

  /** The data Image File Directory (IFD) */
  readonly image: TiffImage;

  /** The mask Image File Directory (IFD), if any. */
  readonly maskImage: TiffImage | null;

  /** The coordinate reference system. */
  readonly crs: number | ProjJson | string;

  /** The height of tiles in pixels. */
  readonly tileHeight: number;

  /** The width of tiles in pixels. */
  readonly tileWidth: number;

  /** The nodata value for the image, if any. */
  readonly nodata: number | null;

  /**
   * Internal: when true, the tile-fetch path logs each dataSource fetch to
   * the console. Set via `GeoTIFF.open({ debug: true })`.
   * @internal
   */
  readonly _debug?: boolean;
}

/** The {@link CachedSubImageTags} that a tile read uses. */
type TileReadTags = {
  /**
   * Tags of `self.image`. For their fields, a tile read uses these rather than
   * `self.cachedPrimaryImageTags`.
   */
  imageTags: CachedSubImageTags;
  /** Tags of `self.maskImage`, or `null` if there's no mask. */
  maskImageTags: CachedSubImageTags | null;
};

export async function fetchTile(
  self: HasTiffReference,
  x: number,
  y: number,
  {
    boundless = true,
    pool,
    signal,
    imageTags,
    maskImageTags,
  }: {
    boundless?: boolean;
    pool?: DecoderPool;
    signal?: AbortSignal;
  } & TileReadTags,
): Promise<Tile> {
  const tileFetch = fetchCogBytes(self, x, y, { signal, imageTags });
  const maskFetch =
    self.maskImage != null
      ? getTile(self.maskImage, x, y, self.dataSource, {
          signal,
          debug: self._debug ? { label: "mask" } : undefined,
          imageTags: maskImageTags!,
        })
      : Promise.resolve(null);

  const [tileBytes, maskBytes] = await Promise.all([tileFetch, maskFetch]);

  return assembleTile(self, x, y, tileBytes, maskBytes, { boundless, pool });
}

/**
 * Decode already-fetched compressed tile (and optional mask) bytes into a
 * {@link Tile}. Performs no I/O — the bytes are supplied by the caller. Shared
 * by {@link fetchTile} (single-tile fetch) and {@link fetchTiles} (batched
 * fetch).
 */
async function assembleTile(
  self: HasTiffReference,
  x: number,
  y: number,
  tileBytes: GetBytesResponse | GetBytesResponse[],
  maskBytes: GetBytesResponse | null,
  { boundless, pool }: { boundless: boolean; pool?: DecoderPool },
): Promise<Tile> {
  const {
    bitsPerSample: bitsPerSamples,
    predictor,
    planarConfiguration,
    sampleFormat: sampleFormats,
    lercParameters,
  } = self.cachedPrimaryImageTags;
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
    littleEndian: self.image.tiff.isLittleEndian,
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
 * Fetch multiple tiles from a GeoTIFF or Overview, batching the underlying
 * reads.
 *
 * Unlike repeated {@link fetchTile} calls, this resolves every requested
 * tile's byte range up front and fetches the data through {@link getTiles} /
 * {@link getMultipleBytes}, which issue every range in one task so the range
 * reader can merge them into far fewer HTTP
 * range requests — a big win when the coordinates form a contiguous block, as
 * they do when assembling a coarse tile from finer covering tiles. Decoding is
 * still done per tile (via the shared {@link assembleTile}); only the I/O is
 * batched.
 *
 * @param self - The GeoTIFF or Overview to fetch tiles from.
 * @param xy - Array of `[x, y]` tile coordinates.
 * @param options - Optional parameters (same as {@link fetchTile}).
 * @returns Array of {@link Tile} objects in the same order as `xy`.
 *
 * @see {@link fetchTile} for single-tile fetching.
 * @see {@link getTiles} for the batched byte reader.
 */
export async function fetchTiles(
  self: HasTiffReference,
  xy: Array<[number, number]>,
  {
    boundless = true,
    pool,
    signal,
    imageTags,
    maskImageTags,
  }: {
    boundless?: boolean;
    pool?: DecoderPool;
    signal?: AbortSignal;
  } & TileReadTags,
): Promise<Tile[]> {
  if (xy.length === 0) {
    return [];
  }

  const dataFetch = fetchCogBytesMultiple(self, xy, { signal, imageTags });
  const maskFetch: Promise<Array<GetBytesResponse | null>> =
    self.maskImage != null
      ? getTiles(self.maskImage, xy, self.dataSource, {
          signal,
          debug: self._debug ? { label: "mask" } : undefined,
          imageTags: maskImageTags!,
        })
      : Promise.resolve(xy.map(() => null));

  const [allTileBytes, allMaskBytes] = await Promise.all([
    dataFetch,
    maskFetch,
  ]);

  return Promise.all(
    xy.map(([x, y], i) =>
      assembleTile(self, x, y, allTileBytes[i]!, allMaskBytes[i] ?? null, {
        boundless,
        pool,
      }),
    ),
  );
}

type GetBytesResponse = { bytes: ArrayBuffer; compression: Compression };
type ByteRange = Awaited<ReturnType<TiffImage["getTileSize"]>>;

/**
 * Opt-in debug tag for {@link getTile} / {@link getBytes}. When present,
 * each underlying `dataSource.fetch` call is logged to the console with the
 * tag's `label`, the offset, and the byte count. When absent, no logging.
 */
type DebugTag = { label: string };

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
    littleEndian: maskImage.tiff.isLittleEndian,
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
    imageTags,
  }: {
    signal?: AbortSignal;
    imageTags: CachedSubImageTags;
  },
): Promise<GetBytesResponse | GetBytesResponse[]> {
  const debug: DebugTag | undefined = self._debug
    ? { label: "data" }
    : undefined;
  switch (self.cachedPrimaryImageTags.planarConfiguration) {
    case PlanarConfiguration.Contig: {
      const tile = await getTile(self.image, x, y, self.dataSource, {
        signal,
        debug,
        imageTags,
      });
      if (tile === null) {
        throw new Error(`Tile at (${x}, ${y}) not found`);
      }
      return tile;
    }
    case PlanarConfiguration.Separate:
      return await fetchBandSeparateTileBytes(self, x, y, {
        signal,
        imageTags,
      });
    default:
      throw new Error(
        `Unsupported PlanarConfiguration: ${self.cachedPrimaryImageTags.planarConfiguration}`,
      );
  }
}

async function findBandSeparateTileByteRanges(
  self: HasTiffReference,
  x: number,
  y: number,
  options?: { signal?: AbortSignal },
): Promise<ByteRange[]> {
  // TODO: error here if user-provided band-indexes are out of bounds
  const { x: tilesPerRow, y: tilesPerColumn } = self.image.tileCount;
  const tilesPerBand = tilesPerRow * tilesPerColumn;
  const numBands = self.cachedPrimaryImageTags.samplesPerPixel;
  const tileSizes = [...Array(numBands).keys()].map((band) => {
    const bandIdx = band * tilesPerBand + y * tilesPerRow + x;
    return getTileByteRange(self.image, bandIdx, options);
  });
  return Promise.all(tileSizes);
}

async function fetchBandSeparateTileBytes(
  self: HasTiffReference,
  x: number,
  y: number,
  options: {
    signal?: AbortSignal;
    imageTags: CachedSubImageTags;
  },
): Promise<GetBytesResponse[]> {
  const { signal, imageTags } = options;
  const debug: DebugTag | undefined = self._debug
    ? { label: "data" }
    : undefined;
  const byteRanges = await findBandSeparateTileByteRanges(self, x, y, options);
  const buffers = byteRanges.map(async ({ offset, imageSize }) => {
    const tile = await getBytes(
      self.image,
      offset,
      imageSize,
      self.dataSource,
      { signal, debug, imageTags },
    );
    if (tile === null) {
      throw new Error(`Tile at (${x}, ${y}) not found`);
    }
    return tile;
  });
  return Promise.all(buffers);
}

/**
 * Batched counterpart to {@link fetchCogBytes}: issue the compressed-byte
 * reads of many tiles together, so the data source can merge them into few
 * HTTP range requests.
 * Returns one entry per input coordinate, in input order. Throws (matching
 * {@link fetchCogBytes}) if a requested tile is sparse / not present.
 */
async function fetchCogBytesMultiple(
  self: HasTiffReference,
  xy: Array<[number, number]>,
  {
    signal,
    imageTags,
  }: {
    signal?: AbortSignal;
    imageTags: CachedSubImageTags;
  },
): Promise<Array<GetBytesResponse | GetBytesResponse[]>> {
  const debug: DebugTag | undefined = self._debug
    ? { label: "data" }
    : undefined;
  switch (self.cachedPrimaryImageTags.planarConfiguration) {
    case PlanarConfiguration.Contig: {
      const tiles = await getTiles(self.image, xy, self.dataSource, {
        signal,
        debug,
        imageTags,
      });
      return tiles.map((tile, i) => {
        if (tile === null) {
          const [x, y] = xy[i]!;
          throw new Error(`Tile at (${x}, ${y}) not found`);
        }
        return tile;
      });
    }
    case PlanarConfiguration.Separate:
      return fetchBandSeparateTileBytesMultiple(self, xy, {
        signal,
        imageTags,
      });
    default:
      throw new Error(
        `Unsupported PlanarConfiguration: ${self.cachedPrimaryImageTags.planarConfiguration}`,
      );
  }
}

/**
 * Batched counterpart to {@link fetchBandSeparateTileBytes}. Every band of
 * every requested tile is flattened into a single {@link getMultipleBytes}
 * call, so the data source can merge reads across both bands and
 * neighbouring tiles; the results are regrouped per tile afterwards.
 */
async function fetchBandSeparateTileBytesMultiple(
  self: HasTiffReference,
  xy: Array<[number, number]>,
  options: {
    signal?: AbortSignal;
    imageTags: CachedSubImageTags;
  },
): Promise<GetBytesResponse[][]> {
  const { signal, imageTags } = options;
  const debug: DebugTag | undefined = self._debug
    ? { label: "data" }
    : undefined;
  const numBands = self.cachedPrimaryImageTags.samplesPerPixel;
  const perTileRanges = await Promise.all(
    xy.map(([x, y]) => findBandSeparateTileByteRanges(self, x, y, options)),
  );
  const flatRanges = perTileRanges.flatMap((ranges) =>
    ranges.map(({ offset, imageSize }) => ({
      offset,
      byteCount: imageSize,
    })),
  );
  const flatResults = await getMultipleBytes(
    self.image,
    flatRanges,
    self.dataSource,
    { signal, debug, imageTags },
  );

  return xy.map(([x, y], t) =>
    flatResults.slice(t * numBands, t * numBands + numBands).map((res) => {
      if (res === null) {
        throw new Error(`Tile at (${x}, ${y}) not found`);
      }
      return res;
    }),
  );
}

/**
 * Load a tile into an ArrayBuffer.
 *
 * If the tile compression is JPEG, this also prepends the image's JPEG tables,
 * from `options.imageTags`, to the resulting ArrayBuffer (see
 * {@link prependJpegTables}).
 *
 * Though this function lives upstream in @cogeotiff/core, we vendor it here
 * so we can route the *tile data* read through a separate source. The tile's
 * byte range is looked up via {@link getTileByteRange}, which reads it through
 * the source that was passed to `Tiff.create` (our header source, whose
 * small reads are widened to blocks and cached). The actual tile bytes are
 * then fetched from `dataSource`, which is merged and cached under its own
 * budget, so tile bytes never evict header blocks.
 */
async function getTile(
  image: TiffImage,
  x: number,
  y: number,
  dataSource: Pick<Source, "fetch">,
  options: {
    signal?: AbortSignal;
    debug?: DebugTag;
    imageTags: CachedSubImageTags;
  },
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

  // Reads TileOffsets[idx] and TileByteCounts[idx] from the header source,
  // not tile data: only the 4–8 byte offset/count entries.
  const { offset, imageSize } = await getTileByteRange(image, idx, {
    signal: options?.signal,
  });

  // The actual tile bytes go through dataSource.
  return getBytes(image, offset, imageSize, dataSource, options);
}

/**
 * Look up a tile's byte range: its `TileOffsets` and `TileByteCounts`
 * entries.
 *
 * When those tables don't fit in the bytes read at open, {@link TiffImage}
 * reads each entry lazily through the header source, whose cache shares one
 * request among every tile with entries in the same chunk. So the lookup runs
 * without `signal`: forwarding it would let one tile's abort fail every other
 * tile sharing that request
 * (https://github.com/developmentseed/deck.gl-raster/issues/690). Instead,
 * `signal` only ends this caller's wait, rejecting with `signal.reason` at
 * once, while the request runs on and fills the cache for the next tile.
 */
function getTileByteRange(
  image: TiffImage,
  index: number,
  options?: { signal?: AbortSignal },
): Promise<ByteRange> {
  const signal = options?.signal;
  // Already aborted: reject without starting a lookup.
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }
  // The main change from upstream cogeotiff, whose `getTile` calls
  // `getTileSize(idx, options)` and so forwards the signal into the shared
  // read. We leave the signal out, so aborting this caller can't fail the
  // read for other tiles waiting on it.
  const lookup = image.getTileSize(index);
  if (!signal) {
    return lookup;
  }
  // Settle with the lookup, unless the signal aborts first: then reject with
  // `signal.reason` at once, while the lookup carries on for other tiles.
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    lookup.then(
      (range) => {
        signal.removeEventListener("abort", onAbort);
        resolve(range);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Read image bytes at the given offset from `dataSource`.
 *
 * Though this function lives upstream in @cogeotiff/core, we vendor it here
 * so we can route reads through the data source rather than the header
 * source that cogeotiff would use by default. The two are merged and cached
 * under separate budgets, so tile data never evicts header blocks.
 */
async function getBytes(
  image: TiffImage,
  offset: number,
  byteCount: number,
  dataSource: Pick<Source, "fetch">,
  options: {
    signal?: AbortSignal;
    debug?: DebugTag;
    imageTags: CachedSubImageTags;
  },
): Promise<{
  bytes: ArrayBuffer;
  compression: Compression;
} | null> {
  if (byteCount === 0) {
    return null;
  }

  if (options?.debug !== undefined) {
    console.log(
      `[geotiff dataSource] ${options.debug.label}: offset=${offset} length=${byteCount}`,
    );
  }

  const bytes = await dataSource.fetch(offset, byteCount, {
    signal: options.signal,
  });
  if (bytes.byteLength < byteCount) {
    throw new Error(
      `Failed to fetch bytes from offset:${offset} wanted:${byteCount} got:${bytes.byteLength}`,
    );
  }

  const compression = image.value(TiffTag.Compression) ?? Compression.None;
  if (compression === Compression.Jpeg) {
    return {
      bytes: prependJpegTables(bytes, options.imageTags.jpegTables),
      compression,
    };
  }
  return { bytes, compression };
}

/**
 * Prepend an image's JPEG tables to one of its JPEG tiles, making a JPEG that
 * a decoder can read on its own.
 *
 * A JPEG TIFF can store the tables that an image's tiles share once, in its
 * JpegTables tag, and leave them out of each tile. The tables and the tile
 * each start with a start-of-image marker and end with an end-of-image marker,
 * so this drops the tables' end-of-image marker and the tile's start-of-image
 * marker. It joins them as cogeotiff's `TiffImage.getJpegHeader` does, but
 * with tables the caller has already read.
 *
 * @param tile A JPEG tile, as stored in the file.
 * @param jpegTables The image's JPEG tables, or `null` if it has none. Then
 *   each tile is a complete JPEG, and this returns it unchanged.
 */
export function prependJpegTables(
  tile: ArrayBuffer,
  jpegTables: Uint8Array | null,
): ArrayBuffer {
  if (jpegTables === null) {
    return tile;
  }
  const tables = jpegTables.subarray(0, jpegTables.length - 2);
  const tileData = new Uint8Array(tile).subarray(2);
  const jpeg = new Uint8Array(tables.length + tileData.length);
  jpeg.set(tables, 0);
  jpeg.set(tileData, tables.length);
  return jpeg.buffer;
}

/**
 * Read image bytes for multiple ranges, issued together.
 *
 * Vectorized counterpart to {@link getBytes}. The non-sparse ranges are read
 * through `dataSource` in one task, so a data source that merges reads (the
 * range reader under `GeoTIFF.fromUrl`) turns them into few requests. Returns
 * one entry per input range, in input order; sparse ranges (`offset === 0` or
 * `byteCount === 0`) yield `null`, matching {@link getBytes}.
 *
 * Vendored from cogeotiff PR #1463 (`TiffImage.getMultipleBytes`) for the same
 * reason as {@link getBytes}: tile data must read through the data source
 * rather than the header source.
 */
export async function getMultipleBytes(
  image: TiffImage,
  ranges: { offset: number; byteCount: number }[],
  dataSource: Pick<Source, "fetch">,
  options: {
    signal?: AbortSignal;
    debug?: DebugTag;
    imageTags: CachedSubImageTags;
  },
): Promise<Array<{ bytes: ArrayBuffer; compression: Compression } | null>> {
  if (ranges.length === 0) {
    return [];
  }

  const results = new Array<{
    bytes: ArrayBuffer;
    compression: Compression;
  } | null>(ranges.length);
  const realRanges: { offset: number; length: number }[] = [];
  const realIndices: number[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    if (range.offset === 0 || range.byteCount === 0) {
      results[i] = null;
    } else {
      realIndices.push(i);
      realRanges.push({ offset: range.offset, length: range.byteCount });
    }
  }

  if (realRanges.length === 0) {
    return results;
  }

  if (options?.debug !== undefined) {
    for (const r of realRanges) {
      console.log(
        `[geotiff dataSource] ${options.debug.label}: offset=${r.offset} length=${r.length}`,
      );
    }
  }

  // One read per range, issued together: the data source (the range reader
  // under `fromUrl`) merges the reads of one task into few requests.
  const fetched = await Promise.all(
    realRanges.map(async (range) => {
      const bytes = await dataSource.fetch(range.offset, range.length, {
        signal: options.signal,
      });
      if (bytes.byteLength < range.length) {
        throw new Error(
          `Failed to fetch bytes from offset:${range.offset} wanted:${range.length} got:${bytes.byteLength}`,
        );
      }
      return bytes;
    }),
  );

  const compression = image.value(TiffTag.Compression) ?? Compression.None;
  for (let k = 0; k < fetched.length; k++) {
    const i = realIndices[k]!;
    const raw = fetched[k]!;
    const bytes =
      compression === Compression.Jpeg
        ? prependJpegTables(raw, options.imageTags.jpegTables)
        : raw;
    results[i] = { bytes, compression };
  }

  return results;
}

/**
 * Load multiple tiles in a single batched I/O round trip.
 *
 * Resolves the offset/size of every requested tile via {@link getTileByteRange}
 * (header-source reads — small entries, served from cached blocks), then
 * fetches the tile data through {@link getMultipleBytes} (one read per tile,
 * issued together for the data source to merge). Returns one entry per input
 * tile, in input order; sparse tiles yield `null` matching {@link getBytes}.
 *
 * Vendored from cogeotiff PR #1463 (`TiffImage.getTiles`) for the same reason as
 * {@link getTile}: the tile-data read must route through `dataSource`.
 */
export async function getTiles(
  image: TiffImage,
  xy: Array<[number, number]>,
  dataSource: Pick<Source, "fetch">,
  options: {
    signal?: AbortSignal;
    debug?: DebugTag;
    imageTags: CachedSubImageTags;
  },
): Promise<Array<{ bytes: ArrayBuffer; compression: Compression } | null>> {
  if (xy.length === 0) {
    return [];
  }

  const { size, tileSize } = image;
  if (tileSize == null) {
    throw new Error("Tiff is not tiled");
  }

  // TODO support GhostOptionTileOrder
  const nyTiles = Math.ceil(size.height / tileSize.height);
  const nxTiles = Math.ceil(size.width / tileSize.width);
  const totalTiles = nxTiles * nyTiles;

  const indices = xy.map(([x, y]) => {
    if (x >= nxTiles || y >= nyTiles) {
      throw new Error(
        `Tile index is outside of range x:${x} >= ${nxTiles} or y:${y} >= ${nyTiles}`,
      );
    }
    const idx = y * nxTiles + x;
    if (idx >= totalTiles) {
      throw new Error(
        `Tile index is outside of tile range: ${idx} >= ${totalTiles}`,
      );
    }
    return idx;
  });

  const sizes = await Promise.all(
    indices.map((i) => getTileByteRange(image, i, { signal: options?.signal })),
  );
  return getMultipleBytes(
    image,
    sizes.map((s) => ({ offset: s.offset, byteCount: s.imageSize })),
    dataSource,
    options,
  );
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
