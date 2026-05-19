import { SourceCache, SourceChunk } from "@chunkd/middleware";
import { SourceView } from "@chunkd/source";
import { SourceHttp } from "@chunkd/source-http";
import { SourceMemory } from "@chunkd/source-memory";
import type { Source, TiffImage, TiffImageTileCount } from "@cogeotiff/core";
import { Photometric, SubFileType, Tiff, TiffTag } from "@cogeotiff/core";
import type { Affine } from "@developmentseed/affine";
import type { ProjJson } from "@developmentseed/proj";
import { crsFromGeoKeys } from "./crs.js";
import { fetchTile, fetchTiles } from "./fetch.js";
import type { BandStatistics, GDALMetadata } from "./gdal-metadata.js";
import { parseGDALMetadata } from "./gdal-metadata.js";
import type { CachedTags, GeoKeyDirectory } from "./ifd.js";
import { extractGeoKeyDirectory, prefetchTags } from "./ifd.js";
import type { ConcurrencyLimiter } from "./limiter.js";
import { LimiterMiddleware } from "./limiter.js";
import { Overview } from "./overview.js";
import type { DecoderPool } from "./pool/pool.js";
import type { Tile } from "./tile.js";
import { createTransform, index, xy } from "./transform.js";

/**
 * A high-level GeoTIFF abstraction built on
 * {@link https://github.com/blacha/cogeotiff | @cogeotiff/core}'s `Tiff` and
 * `TiffImage` classes.
 *
 * This class separates data IFDs from mask IFDs, pairs them by resolution
 * level, and exposes sorted overviews. Intentionally mirrors the Python
 * {@link https://github.com/developmentseed/async-geotiff | async-geotiff} API
 * as closely as possible.
 *
 * Construct via {@link GeoTIFF.fromUrl}, {@link GeoTIFF.fromArrayBuffer},
 * {@link GeoTIFF.open} or {@link GeoTIFF.fromTiff}.
 *
 * @see {@link Overview} for reduced-resolution overview images.
 */
export class GeoTIFF {
  /**
   * Reduced-resolution overview levels, sorted finest-to-coarsest.
   *
   * Does not include the full-resolution image — use {@link fetchTile} on the
   * GeoTIFF instance itself for that.
   */
  readonly overviews: Overview[];

  /** A cached CRS value. */
  private _crs?: number | ProjJson;

  /** Cached TIFF tags that are pre-fetched when opening the GeoTIFF. */
  readonly cachedTags: CachedTags;

  /** The data source used for fetching tile data.
   *
   * This is typically the raw source (e.g. HTTP or memory) rather than a
   * layered source with caching and chunking, to avoid unnecessary copying of
   * tile data through cache layers.
   */
  readonly dataSource: Pick<Source, "fetch">;

  /** The underlying Tiff instance. */
  readonly tiff: Tiff;

  /** The primary (full-resolution) TiffImage. */
  readonly image: TiffImage;

  /** The mask IFD of the full-resolution GeoTIFF, if any. */
  readonly maskImage: TiffImage | null;

  /** The GeoKeyDirectory of the primary IFD. */
  readonly gkd: GeoKeyDirectory;

  /** Parsed GDALMetadata tag, if present. */
  readonly gdalMetadata: GDALMetadata | null;

  /**
   * Internal: when true, log each `dataSource` fetch (image tile data and
   * mask tile data) to the console with offset/length and a `data`/`mask`
   * label. Enable via the `debug` option on {@link GeoTIFF.open} or
   * {@link GeoTIFF.fromUrl}. Read by the tile-fetch path; not part of the
   * public API surface.
   *
   * @internal
   */
  readonly _debug: boolean;

  private constructor(
    tiff: Tiff,
    image: TiffImage,
    maskImage: TiffImage | null,
    gkd: GeoKeyDirectory,
    overviews: Overview[],
    cachedTags: CachedTags,
    dataSource: Pick<Source, "fetch">,
    gdalMetadata: GDALMetadata | null,
    debug: boolean,
  ) {
    this.tiff = tiff;
    this.image = image;
    this.maskImage = maskImage;
    this.gkd = gkd;
    this.overviews = overviews;
    this.cachedTags = cachedTags;
    this.dataSource = dataSource;
    this.gdalMetadata = gdalMetadata;
    this._debug = debug;
  }

  /**
   * Open a GeoTIFF from a @cogeotiff/core Source.
   *
   * This creates and initialises the underlying Tiff, then classifies IFDs.
   *
   * @param options.dataSource A source for fetching tile data. This is separate from the source used to construct the TIFF to allow for separate caching implementations.
   * @param options.headerSource The source used to construct the TIFF. This is typically a layered source with caching and chunking, to optimise access to TIFF tags and IFDs. Callers who want to control the initial read size should compose a `SourceChunk` of the desired block size; cogeotiff's default `defaultReadSize` (16 KiB) gets padded up by the chunking layer anyway.
   * @param options.signal An optional {@link AbortSignal} to cancel the header reads.
   * @param options.debug When true, the returned GeoTIFF logs each tile/mask data fetch to the console. Off by default.
   */
  static async open(options: {
    dataSource: Pick<Source, "fetch">;
    headerSource: Source;
    signal?: AbortSignal;
    debug?: boolean;
  }): Promise<GeoTIFF> {
    const { dataSource, headerSource, signal, debug } = options;
    // Construct + init in two steps so we don't have to pass cogeotiff's
    // `defaultReadSize` ourselves (the constructor defaults it to
    // `Tiff.DefaultReadSize` when no options are provided). In the typical
    // fromUrl path, SourceChunk pads any small request up to the block size
    // anyway, so tuning this independently of the chunk size is rarely useful.
    const tiff = await new Tiff(headerSource).init({ signal });
    // Disable cogeotiff's GDAL leader-bytes path so `TiffImage.getTileSize`
    // always reads from TileOffsets/TileByteCounts through the header source.
    // The leader-bytes optimization assumes a tile fits in one chunk, which
    // breaks for typical 256x256x3 tiles (~200 KB) vs. our 64 KiB blocks.
    // Without this, the leader read pulls image-data bytes into the header
    // cache, evicting metadata. cogeotiff core only reads `tiff.options` in
    // that one path, so nulling it here is safe.
    //
    // TODO: replace this with a cleaner opt-out once upstream supports one
    // https://github.com/blacha/cogeotiff/issues/1467
    tiff.options = undefined;
    return GeoTIFF.fromTiff(tiff, dataSource, { signal, debug });
  }

  /**
   * Create a GeoTIFF from an already-initialised Tiff instance.
   *
   * All IFDs are walked; mask IFDs are matched to data IFDs by matching
   * (width, height).  Overviews are sorted from finest to coarsest resolution.
   *
   * @param dataSource A source for fetching tile data. This is separate from the source used to construct the TIFF to allow for separate caching implementations.
   * @param options.signal An optional {@link AbortSignal} to cancel header tag reads.
   * @param options.debug When true, the returned GeoTIFF logs each tile/mask data fetch to the console.
   */
  static async fromTiff(
    tiff: Tiff,
    dataSource: Pick<Source, "fetch">,
    options: { signal?: AbortSignal; debug?: boolean } = {},
  ): Promise<GeoTIFF> {
    const { signal, debug = false } = options;
    const images = tiff.images;
    if (images.length === 0) {
      throw new Error("TIFF does not contain any IFDs");
    }

    // Force loading of important tags in sub-images
    // https://github.com/blacha/cogeotiff/blob/4781a6375adf419da9f0319d15c8a67284dfb0c4/packages/core/src/tiff.image.ts#L72-L88
    await Promise.all(images.map((image) => image.init(true, { signal })));

    const primaryImage = images[0]!;
    const gkd = extractGeoKeyDirectory(primaryImage);

    // Classify IFDs (skipping index 0) into data and mask buckets
    // keyed by "width,height".
    const dataIFDs = new Map<string, TiffImage>();
    const maskIFDs = new Map<string, TiffImage>();

    for (let i = 1; i < images.length; i++) {
      const image = images[i]!;
      const size = image.size;
      const key = `${size.width},${size.height}`;

      if (isMaskIfd(image)) {
        maskIFDs.set(key, image);
      } else {
        dataIFDs.set(key, image);
      }
    }

    // Find the primary mask, if any.
    const primaryKey = `${primaryImage.size.width},${primaryImage.size.height}`;
    const primaryMask = maskIFDs.get(primaryKey) ?? null;

    // Build reduced-resolution Overview instances, sorted by pixel count
    // descending (finest first).
    const dataEntries = Array.from(dataIFDs.entries());
    dataEntries.sort((a, b) => {
      const sa = a[1].size;
      const sb = b[1].size;
      return sb.width * sb.height - sa.width * sa.height;
    });

    const cachedTags = await prefetchTags(primaryImage, { signal });
    const gdalMetadata = parseGDALMetadata(cachedTags.gdalMetadata, {
      count: cachedTags.samplesPerPixel,
    });

    // Two-phase construction: create the GeoTIFF first (with empty overviews),
    // then build Overviews that reference back to it.
    const geotiff = new GeoTIFF(
      tiff,
      primaryImage,
      primaryMask,
      gkd,
      [],
      cachedTags,
      dataSource,
      gdalMetadata,
      debug,
    );

    const overviews: Overview[] = dataEntries.map(([key, dataImage]) => {
      const maskImage = maskIFDs.get(key) ?? null;
      return new Overview(
        geotiff,
        gkd,
        dataImage,
        maskImage,
        cachedTags,
        dataSource,
      );
    });

    // Mutate the readonly field — safe here because we're still in the factory.
    (geotiff as { overviews: Overview[] }).overviews = overviews;

    return geotiff;
  }

  /**
   * Create a GeoTIFF from an ArrayBuffer containing the entire file.
   *
   * This is a convenience method that wraps the ArrayBuffer in a memory source
   * and calls {@link GeoTIFF.open}. For large files, consider using
   * {@link GeoTIFF.fromUrl} or {@link GeoTIFF.open} with a chunked HTTP source
   * to avoid loading the entire file into memory at once.
   *
   * @param input The ArrayBuffer containing the GeoTIFF file data.
   * @returns A Promise that resolves to a GeoTIFF instance.
   */
  static async fromArrayBuffer(input: ArrayBuffer): Promise<GeoTIFF> {
    const source = new SourceMemory("memory://input.tif", input);
    return await GeoTIFF.open({
      dataSource: source,
      headerSource: source,
    });
  }

  /**
   * Create a new GeoTIFF from a URL.
   *
   * Wraps the HTTP source with a fixed-size block-aligned LRU cache tuned for
   * TIFF metadata. cogeotiff's lazy per-entry reads (for tile offsets, byte
   * counts, and other tag values) are served by the block cache; adjacent
   * entries within a single block hit one underlying request. Tile data reads
   * bypass the cache and go straight to the raw HTTP source.
   *
   * @param url The URL of the GeoTIFF to open.
   * @param options Optional parameters.
   * @param options.chunkSize Bytes per chunk for the header cache. Defaults to 64 KiB (matches geotiff.js's BlockedSource).
   * @param options.cacheSize Total cache size in bytes. Defaults to 8 MiB (~128 blocks at the default chunk size).
   * @param options.signal An optional {@link AbortSignal} to cancel the header reads.
   * @param options.debug When true, the returned GeoTIFF logs each tile/mask data fetch to the console with offset/length and a `data`/`mask` label. Off by default.
   * @param options.concurrencyLimiter Caps concurrent HTTP requests for the *tile data* path. Header / metadata reads (through the cached SourceView) are not gated. Pass `null` to explicitly disable; omit (or pass `undefined`) for the same effect — `GeoTIFF.fromUrl` does *not* default to a shared limiter on its own. The deck.gl-geotiff layers default to a shared {@link PerOriginSemaphore} via their `defaultProps`.
   * @returns A Promise that resolves to a GeoTIFF instance.
   */
  static async fromUrl(
    url: string | URL,
    {
      chunkSize = 64 * 1024,
      cacheSize = 8 * 1024 * 1024,
      signal,
      debug,
      concurrencyLimiter,
    }: {
      chunkSize?: number;
      cacheSize?: number;
      signal?: AbortSignal;
      debug?: boolean;
      concurrencyLimiter?: ConcurrencyLimiter | null;
    } = {},
  ): Promise<GeoTIFF> {
    const source = new SourceHttp(url, {});

    // TEMPORARY workaround for
    // https://github.com/developmentseed/deck.gl-raster/issues/524
    //
    // `@chunkd/source-http` records `source.metadata.size` from the first range
    // response, preferring `Content-Range` and falling back to `Content-Length`.
    // In a browser, `Content-Range` is only readable when the server lists it in
    // `Access-Control-Expose-Headers` (S3 does not by default), so the
    // `Content-Length` fallback — the length of a single *chunk*, not the file —
    // gets recorded as the file size. Reads past that bogus size would then be
    // rejected as out-of-bounds.
    //
    // Seed `metadata` ourselves so `SourceHttp` never records a size (it only
    // fills in `metadata` while it is still null), treating the source as having
    // unbounded length. Remove once the upstream fix lands.
    source.metadata = { size: Number.POSITIVE_INFINITY };

    // When a limiter is supplied, slot a LimiterMiddleware into both
    // sources' middleware stacks. On the header source, it sits *after*
    // SourceChunk + SourceCache so a cache hit short-circuits and never
    // consumes a slot — only network reads that escape the cache are gated.
    // On the data source (no caching), every fetch is gated.
    const limiterMW = concurrencyLimiter
      ? new LimiterMiddleware({
          url: new URL(url),
          limiter: concurrencyLimiter,
        })
      : null;

    const view = new SourceView(source, [
      new SourceChunk({ size: chunkSize }),
      new SourceCache({ size: cacheSize }),
      ...(limiterMW ? [limiterMW] : []),
    ]);

    const dataSource: Pick<Source, "fetch"> = limiterMW
      ? new SourceView(source, [limiterMW])
      : source;

    return await GeoTIFF.open({
      dataSource,
      headerSource: view,
      signal,
      debug,
    });
  }

  // ── Properties from the primary image ─────────────────────────────────

  /**
   * The CRS parsed from the GeoKeyDirectory.
   *
   * Returns an EPSG code (number) for EPSG-coded CRSes, or a PROJJSON object
   * for user-defined CRSes. The result is cached after the first access.
   *
   * See also {@link GeoTIFF.epsg} for the EPSG code directly from the TIFF tags.
   */
  get crs(): number | ProjJson {
    if (this._crs === undefined) {
      this._crs = crsFromGeoKeys(this.gkd);
    }
    return this._crs;
  }

  /** Image width in pixels. */
  get width(): number {
    return this.image.size.width;
  }

  /** Image height in pixels. */
  get height(): number {
    return this.image.size.height;
  }

  /** The number of tiles in the x and y directions */
  get tileCount(): TiffImageTileCount {
    return this.image.tileCount;
  }

  /** Tile width in pixels. */
  get tileWidth(): number {
    return this.image.tileSize.width;
  }

  /** Tile height in pixels. */
  get tileHeight(): number {
    return this.image.tileSize.height;
  }

  /** The no data value, or null if not set. */
  get nodata(): number | null {
    return this.image.noData;
  }

  /** Whether the primary image is tiled. */
  get isTiled(): boolean {
    return this.image.isTiled();
  }

  /**
   * The pre-existing statistics for each band, if available.
   *
   * Extracted from the GDALMetadata TIFF tag; never computed on demand.
   * Keys are **1-based** band indices to match GDAL's convention.
   *
   * Returns `null` if no statistics are stored in the file.
   */
  get storedStats(): ReadonlyMap<number, BandStatistics> | null {
    const stats = this.gdalMetadata?.bandStatistics;
    return stats && stats.size > 0 ? stats : null;
  }

  /**
   * The offset for each band (0-indexed), defaulting to 0.
   *
   * Extracted from the GDALMetadata TIFF tag.
   */
  get offsets(): number[] {
    return this.gdalMetadata?.offsets ?? Array<number>(this.count).fill(0);
  }

  /**
   * The scale for each band (0-indexed), defaulting to 1.
   *
   * Extracted from the GDALMetadata TIFF tag.
   */
  get scales(): number[] {
    return this.gdalMetadata?.scales ?? Array<number>(this.count).fill(1);
  }

  /** Number of bands (samples per pixel). */
  get count(): number {
    return this.image.value(TiffTag.SamplesPerPixel) ?? 1;
  }

  /** Bounding box [minX, minY, maxX, maxY] in the CRS. */
  get bbox(): [number, number, number, number] {
    return this.image.bbox;
  }

  /**
   * Return the dataset's georeferencing transformation matrix.
   */
  get transform(): Affine {
    const { modelPixelScale, modelTiepoint, modelTransformation } =
      this.cachedTags;
    return createTransform({
      modelTiepoint,
      modelPixelScale,
      modelTransformation,
      rasterType: this.gkd.rasterType,
    });
  }

  // Mixins

  /** Fetch a single tile from the full-resolution image.
   *
   * @param x The tile column index (0-based).
   * @param y The tile row index (0-based).
   * @param options Optional parameters for fetching the tile.
   * @param options.boundless Whether to clip tiles that are partially outside the image bounds. When `true`, no clipping is applied and edge tiles are returned at the full nominal tile size. Defaults to `true`.
   * @param options.pool An optional {@link DecoderPool} for decoding the tile data. If not provided, a new decoder will be created for each tile.
   * @param options.signal An optional {@link AbortSignal} to cancel the fetch request.
   */
  async fetchTile(
    x: number,
    y: number,
    options: {
      boundless?: boolean;
      pool?: DecoderPool;
      signal?: AbortSignal;
    } = {},
  ): Promise<Tile> {
    return await fetchTile(this, x, y, options);
  }

  /**
   * Fetch multiple tiles in parallel.
   *
   * A future implementation may coalesce contiguous byte ranges to reduce
   * the number of HTTP requests.
   *
   * @param xy - Array of `[x, y]` tile coordinates.
   * @param options - Optional parameters (same as {@link fetchTile}).
   * @returns Array of {@link Tile} objects in the same order as `xy`.
   *
   * @see {@link fetchTile} for single-tile fetching.
   */
  async fetchTiles(
    xy: Array<[number, number]>,
    options: {
      boundless?: boolean;
      pool?: DecoderPool;
      signal?: AbortSignal;
    } = {},
  ): Promise<Tile[]> {
    return await fetchTiles(this, xy, options);
  }

  // Transform mixin

  /**
   * Get the (row, col) pixel index containing the geographic coordinate (x, y).
   *
   * @param x          x coordinate in the CRS.
   * @param y          y coordinate in the CRS.
   * @param op         Rounding function applied to fractional pixel indices.
   *                   Defaults to Math.floor.
   * @returns          [row, col] pixel indices.
   */
  index(
    x: number,
    y: number,
    op: (n: number) => number = Math.floor,
  ): [number, number] {
    return index(this, x, y, op);
  }

  /**
   * Get the geographic (x, y) coordinate of the pixel at (row, col).
   *
   * @param row        Pixel row.
   * @param col        Pixel column.
   * @param offset     Which part of the pixel to return.  Defaults to "center".
   * @returns          [x, y] in the CRS.
   */
  xy(
    row: number,
    col: number,
    offset: "center" | "ul" | "ur" | "ll" | "lr" = "center",
  ): [number, number] {
    return xy(this, row, col, offset);
  }
}

/**
 * Determine whether a TiffImage is a mask IFD.
 *
 * A mask IFD has SubFileType with the Mask bit set (value 4) AND
 * PhotometricInterpretation === Mask (4).
 */
export function isMaskIfd(image: TiffImage): boolean {
  const subFileType = image.value(TiffTag.SubFileType);
  const photometric = image.value(TiffTag.Photometric);

  return (
    subFileType !== null &&
    (subFileType & SubFileType.Mask) !== 0 &&
    photometric === Photometric.Mask
  );
}
