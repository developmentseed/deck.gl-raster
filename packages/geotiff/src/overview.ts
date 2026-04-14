import type { Source, TiffImage, TiffImageTileCount } from "@cogeotiff/core";
import type { Affine } from "@developmentseed/affine";
import { compose, scale } from "@developmentseed/affine";
import type { ProjJson } from "@developmentseed/proj";
import { fetchTile, fetchTiles } from "./fetch.js";
import type { GeoTIFF } from "./geotiff.js";
import type { CachedTags, GeoKeyDirectory } from "./ifd.js";
import type { DecoderPool } from "./pool/pool.js";
import type { Tile } from "./tile.js";
import { index, xy } from "./transform.js";

/**
 * A single resolution level of a GeoTIFF — either the full-resolution image
 * or a reduced-resolution overview.  Pairs the data IFD with its
 * corresponding mask IFD (if any).
 */
export class Overview {
  readonly cachedTags: CachedTags;

  /** The data source used for fetching tile data. */
  readonly dataSource: Pick<Source, "fetch">;

  /** A reference to the parent GeoTIFF object. */
  readonly geotiff: GeoTIFF;

  /** The GeoKeyDirectory of the primary IFD. */
  readonly gkd: GeoKeyDirectory;

  /** The data IFD for this resolution level. */
  readonly image: TiffImage;

  /** The IFD for the mask associated with this overview level, if any. */
  readonly maskImage: TiffImage | null = null;

  constructor(
    geotiff: GeoTIFF,
    gkd: GeoKeyDirectory,
    image: TiffImage,
    maskImage: TiffImage | null,
    cachedTags: CachedTags,
    dataSource: Pick<Source, "fetch">,
  ) {
    this.geotiff = geotiff;
    this.gkd = gkd;
    this.image = image;
    this.maskImage = maskImage;
    this.cachedTags = cachedTags;
    this.dataSource = dataSource;
  }

  /**
   * The CRS parsed from the GeoKeyDirectory.
   *
   * Returns an EPSG code (number) for EPSG-coded CRSes, or a PROJJSON object
   * for user-defined CRSes. The result is cached after the first access.
   *
   * See also {@link GeoTIFF.epsg} for the EPSG code directly from the TIFF tags.
   */
  get crs(): number | ProjJson {
    return this.geotiff.crs;
  }

  /** Image height in pixels. */
  get height(): number {
    return this.image.size.height;
  }

  /** The no data value, or null if not set. */
  get nodata(): number | null {
    return this.geotiff.nodata;
  }

  /** The number of tiles in the x and y directions */
  get tileCount(): TiffImageTileCount {
    return this.image.tileCount;
  }

  /** Tile height in pixels. */
  get tileHeight(): number {
    return this.image.tileSize.height;
  }

  /** Tile width in pixels. */
  get tileWidth(): number {
    return this.image.tileSize.width;
  }

  /**
   * Return the dataset's georeferencing transformation matrix.
   */
  get transform(): Affine {
    const fullTransform = this.geotiff.transform;
    const scaleX = this.geotiff.width / this.width;
    const scaleY = this.geotiff.height / this.height;
    return compose(fullTransform, scale(scaleX, scaleY));
  }

  /** Image width in pixels. */
  get width(): number {
    return this.image.size.width;
  }

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

  // TiledMixin

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
