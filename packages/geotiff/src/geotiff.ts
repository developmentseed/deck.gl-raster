import type { Source, TiffImage } from "@cogeotiff/core";
import { Photometric, SubFileType, Tiff, TiffTag } from "@cogeotiff/core";
import type { Affine } from "./affine.js";
import type { FetchOptions, TileBytes } from "./overview.js";
import { Overview } from "./overview.js";
import { index, xy } from "./transform.js";

/**
 * A higher-level GeoTIFF abstraction built on @cogeotiff/core.
 *
 * Separates data IFDs from mask IFDs, pairs them by resolution level,
 * and exposes sorted overviews.  Mirrors the Python async-geotiff API.
 *
 * Construct via `GeoTIFF.open(source)` or `GeoTIFF.fromTiff(tiff)`.
 */
export class GeoTIFF {
  /**
   * Reduced-resolution overview levels, sorted finest-to-coarsest.
   *
   * Does not include the full-resolution image — use `fetchTile` / methods
   * on the GeoTIFF instance itself for that.
   */
  readonly overviews: Overview[];
  /** Affine geotransform of the full-resolution image. */
  readonly transform: Affine;
  /** The primary (full-resolution) TiffImage. Useful for tag/geo key access. */
  readonly primaryImage: TiffImage;
  /** The underlying Tiff instance. */
  readonly tiff: Tiff;

  /** Overview wrapper around the primary image for the convenience delegates. */
  private readonly _primary: Overview;

  private constructor(
    tiff: Tiff,
    primary: Overview,
    overviews: Overview[],
    transform: Affine,
    primaryImage: TiffImage,
  ) {
    this.tiff = tiff;
    this._primary = primary;
    this.overviews = overviews;
    this.transform = transform;
    this.primaryImage = primaryImage;
  }

  /**
   * Open a GeoTIFF from a @cogeotiff/core Source.
   *
   * This creates and initialises the underlying Tiff, then classifies IFDs.
   */
  static async open(source: Source): Promise<GeoTIFF> {
    const tiff = await Tiff.create(source);
    return GeoTIFF.fromTiff(tiff);
  }

  /**
   * Create a GeoTIFF from an already-initialised Tiff instance.
   *
   * All IFDs are walked; mask IFDs are matched to data IFDs by matching
   * (width, height).  Overviews are sorted from finest to coarsest resolution.
   */
  static fromTiff(tiff: Tiff): GeoTIFF {
    const images = tiff.images;
    if (images.length === 0) {
      throw new Error("TIFF does not contain any IFDs");
    }

    const primaryImage = images[0]!;
    const baseTransform = extractGeotransform(primaryImage);
    const primaryWidth = primaryImage.size.width;

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

    // Build the primary Overview (full-resolution image + its mask, if any)
    const primaryKey = `${primaryImage.size.width},${primaryImage.size.height}`;
    const primary = new Overview(
      primaryImage,
      maskIFDs.get(primaryKey) ?? null,
      baseTransform,
    );

    // Build reduced-resolution Overview instances, sorted by pixel count
    // descending (finest first).
    const dataEntries = Array.from(dataIFDs.entries());
    dataEntries.sort((a, b) => {
      const sa = a[1].size;
      const sb = b[1].size;
      return sb.width * sb.height - sa.width * sa.height;
    });

    const overviews: Overview[] = dataEntries.map(([key, dataImage]) => {
      const maskImage = maskIFDs.get(key) ?? null;
      const overviewWidth = dataImage.size.width;

      // Scale the base transform for this overview level.
      const scale = primaryWidth / overviewWidth;
      const [a, b, c, d, e, f] = baseTransform;
      const overviewTransform: Affine = [
        a * scale,
        b * scale,
        c,
        d * scale,
        e * scale,
        f,
      ];

      return new Overview(dataImage, maskImage, overviewTransform);
    });

    return new GeoTIFF(tiff, primary, overviews, baseTransform, primaryImage);
  }

  // ── Properties from the primary image ─────────────────────────────────

  /** Image width in pixels. */
  get width(): number {
    return this._primary.width;
  }

  /** Image height in pixels. */
  get height(): number {
    return this._primary.height;
  }

  /** Tile width in pixels. */
  get tileWidth(): number {
    return this._primary.tileWidth;
  }

  /** Tile height in pixels. */
  get tileHeight(): number {
    return this._primary.tileHeight;
  }

  /** The NoData value, or null if not set. */
  get nodata(): number | null {
    return this.primaryImage.noData;
  }

  /** Whether the primary image is tiled. */
  get isTiled(): boolean {
    return this.primaryImage.isTiled();
  }

  /** Number of bands (samples per pixel). */
  get count(): number {
    return (this.primaryImage.value(TiffTag.SamplesPerPixel) as number) ?? 1;
  }

  /** EPSG code from GeoTIFF tags, or null if not set. */
  get epsg(): number | null {
    return this.primaryImage.epsg;
  }

  /** Bounding box [minX, minY, maxX, maxY] in the CRS. */
  get bbox(): [number, number, number, number] {
    return this.primaryImage.bbox;
  }

  // ── Convenience delegates to the full-resolution image ────────────────

  /** Fetch a single tile from the full-resolution image. */
  async fetchTile(
    x: number,
    y: number,
    options?: FetchOptions,
  ): Promise<TileBytes | null> {
    return this._primary.fetchTile(x, y, options);
  }

  /** Fetch data and mask tiles in parallel from the full-resolution image. */
  async fetchTileWithMask(
    x: number,
    y: number,
    options?: FetchOptions,
  ): Promise<{
    data: TileBytes;
    mask: TileBytes | null;
  } | null> {
    return this._primary.fetchTileWithMask(x, y, options);
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
 * Extract affine geotransform from a TiffImage.
 *
 * Returns [a, b, c, d, e, f] where:
 *   x = a * col + b * row + c
 *   y = d * col + e * row + f
 */
export function extractGeotransform(image: TiffImage): Affine {
  const origin = image.origin;
  const resolution = image.resolution;

  // Check for rotation via ModelTransformation
  const modelTransformation = image.value(TiffTag.ModelTransformation);

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

/**
 * Determine whether a TiffImage is a mask IFD.
 *
 * A mask IFD has SubFileType with the Mask bit set (value 4) AND
 * PhotometricInterpretation === Mask (4).
 */
export function isMaskIfd(image: TiffImage): boolean {
  const subFileType = image.value(TiffTag.SubFileType) ?? 0;
  const photometric = image.value(TiffTag.Photometric);

  return (
    (subFileType & SubFileType.Mask) !== 0 && photometric === Photometric.Mask
  );
}
