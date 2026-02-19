import { SourceCache } from "@chunkd/middleware";
import { SourceChunk } from "@chunkd/middleware/build/src/middleware/chunk.js";
import { SourceView } from "@chunkd/source";
import { SourceHttp } from "@chunkd/source-http";
import { SourceMemory } from "@chunkd/source-memory";
import type { Source, TiffImage } from "@cogeotiff/core";
import { Photometric, SubFileType, Tiff, TiffTag } from "@cogeotiff/core";
import type { Affine } from "@developmentseed/affine";
import type { ProjJson } from "./crs.js";
import { crsFromGeoKeys } from "./crs.js";
import { fetchTile } from "./fetch.js";
import type { CachedTags, GeoKeyDirectory } from "./ifd.js";
import { extractGeoKeyDirectory, prefetchTags } from "./ifd.js";
import { Overview } from "./overview.js";
import type { Tile } from "./tile.js";
import { index, xy } from "./transform.js";

/**
 * A higher-level GeoTIFF abstraction built on @cogeotiff/core.
 *
 * Separates data IFDs from mask IFDs, pairs them by resolution level,
 * and exposes sorted overviews.  Mirrors the Python async-geotiff API.
 *
 * Construct via `GeoTIFF.create(source)` or `GeoTIFF.fromTiff(tiff)`.
 */
export class GeoTIFF {
  /**
   * Reduced-resolution overview levels, sorted finest-to-coarsest.
   *
   * Does not include the full-resolution image — use `fetchTile` / methods
   * on the GeoTIFF instance itself for that.
   */
  readonly overviews: Overview[];

  /** A cached CRS value. */
  private _crs?: number | ProjJson;

  /** Cached TIFF tags that are pre-fetched when opening the GeoTIFF. */
  readonly cachedTags: CachedTags;

  /** The underlying Tiff instance. */
  readonly tiff: Tiff;

  /** The primary (full-resolution) TiffImage. */
  readonly image: TiffImage;

  /** The mask IFD of the full-resolution GeoTIFF, if any. */
  readonly maskImage: TiffImage | null;

  /** The GeoKeyDirectory of the primary IFD. */
  readonly gkd: GeoKeyDirectory;

  private constructor(
    tiff: Tiff,
    image: TiffImage,
    maskImage: TiffImage | null,
    gkd: GeoKeyDirectory,
    overviews: Overview[],
    cachedTags: CachedTags,
  ) {
    this.tiff = tiff;
    this.image = image;
    this.maskImage = maskImage;
    this.gkd = gkd;
    this.overviews = overviews;
    this.cachedTags = cachedTags;
  }

  /**
   * Open a GeoTIFF from a @cogeotiff/core Source.
   *
   * This creates and initialises the underlying Tiff, then classifies IFDs.
   */
  static async create(source: Source): Promise<GeoTIFF> {
    const tiff = await Tiff.create(source);
    return GeoTIFF.fromTiff(tiff);
  }

  /**
   * Create a GeoTIFF from an already-initialised Tiff instance.
   *
   * All IFDs are walked; mask IFDs are matched to data IFDs by matching
   * (width, height).  Overviews are sorted from finest to coarsest resolution.
   */
  static async fromTiff(tiff: Tiff): Promise<GeoTIFF> {
    const images = tiff.images;
    if (images.length === 0) {
      throw new Error("TIFF does not contain any IFDs");
    }

    // Force loading of important tags in sub-images
    // https://github.com/blacha/cogeotiff/blob/4781a6375adf419da9f0319d15c8a67284dfb0c4/packages/core/src/tiff.image.ts#L72-L88
    await Promise.all(images.map((image) => image.init(true)));

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

    const cachedTags = await prefetchTags(primaryImage);

    // Two-phase construction: create the GeoTIFF first (with empty overviews),
    // then build Overviews that reference back to it.
    const geotiff = new GeoTIFF(
      tiff,
      primaryImage,
      primaryMask,
      gkd,
      [],
      cachedTags,
    );

    const overviews: Overview[] = dataEntries.map(([key, dataImage]) => {
      const maskImage = maskIFDs.get(key) ?? null;
      return new Overview(geotiff, gkd, dataImage, maskImage, cachedTags);
    });

    // Mutate the readonly field — safe here because we're still in the factory.
    (geotiff as { overviews: Overview[] }).overviews = overviews;

    return geotiff;
  }

  static async fromArrayBuffer(input: ArrayBuffer): Promise<GeoTIFF> {
    const source = new SourceMemory("memory://input.tif", input);
    return await GeoTIFF.create(source);
  }

  static async fromUrl(
    url: string | URL,
    {
      chunkSize = 32 * 1024,
      cacheSize = 1024 * 1024 * 1024,
    }: { chunkSize?: number; cacheSize?: number } = {},
  ): Promise<GeoTIFF> {
    // read files in chunks
    const chunk = new SourceChunk({ size: chunkSize });
    // 1MB cache for recently accessed chunks
    const cache = new SourceCache({ size: cacheSize });

    const source = new SourceHttp(url);
    const view = new SourceView(source, [chunk, cache]);

    return await GeoTIFF.create(view);
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

  /** Tile width in pixels. */
  get tileWidth(): number {
    return this.image.tileSize.width;
  }

  /** Tile height in pixels. */
  get tileHeight(): number {
    return this.image.tileSize.height;
  }

  /** The NoData value, or null if not set. */
  get nodata(): number | null {
    return this.image.noData;
  }

  /** Whether the primary image is tiled. */
  get isTiled(): boolean {
    return this.image.isTiled();
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
    const origin = this.image.origin;
    const resolution = this.image.resolution;

    // Check for rotation via ModelTransformation.
    // This tag is pre-fetched by @cogeotiff/core during initialization,
    // so value() is safe to call synchronously.
    const modelTransformation: number[] | null = this.image.value(
      TiffTag.ModelTransformation,
    );

    let b = 0; // row rotation
    let d = 0; // column rotation

    if (modelTransformation != null && modelTransformation.length >= 16) {
      b = modelTransformation[1]!;
      d = modelTransformation[4]!;
    }

    return [
      resolution[0], // a: pixel width (x per col)
      b, // b: row rotation
      origin[0], // c: x origin
      d, // d: column rotation
      resolution[1], // e: pixel height (negative = north-up)
      origin[1], // f: y origin
    ];
  }

  // Mixins

  /** Fetch a single tile from the full-resolution image. */
  async fetchTile(
    x: number,
    y: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<Tile> {
    return await fetchTile(this, x, y, options);
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
