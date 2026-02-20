import type { TiffImage } from "@cogeotiff/core";
import type { Affine } from "@developmentseed/affine";
import { compose, scale } from "@developmentseed/affine";
import type { ProjJson } from "./crs.js";
import { fetchTile } from "./fetch.js";
import type { GeoTIFF } from "./geotiff.js";
import type { CachedTags, GeoKeyDirectory } from "./ifd.js";
import type { Tile } from "./tile.js";
import { tileCount } from "./tile.js";
import { index, xy } from "./transform.js";

/**
 * A single resolution level of a GeoTIFF — either the full-resolution image
 * or a reduced-resolution overview.  Pairs the data IFD with its
 * corresponding mask IFD (if any).
 */
export class Overview {
  readonly cachedTags: CachedTags;

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
  ) {
    this.geotiff = geotiff;
    this.gkd = gkd;
    this.image = image;
    this.maskImage = maskImage;
    this.cachedTags = cachedTags;
  }

  get crs(): number | ProjJson {
    return this.geotiff.crs;
  }

  get height(): number {
    return this.image.size.height;
  }

  get nodata(): number | null {
    return this.geotiff.nodata;
  }

  get tileHeight(): number {
    return this.image.tileSize.height;
  }

  get tileWidth(): number {
    return this.image.tileSize.width;
  }

  get transform(): Affine {
    const fullTransform = this.geotiff.transform;
    const scaleX = this.geotiff.width / this.width;
    const scaleY = this.geotiff.height / this.height;
    return compose(fullTransform, scale(scaleX, scaleY));
  }

  get width(): number {
    return this.image.size.width;
  }

  /** Fetch a single tile from the full-resolution image. */
  async fetchTile(
    x: number,
    y: number,
    options: { boundless?: boolean; signal?: AbortSignal } = {},
  ): Promise<Tile> {
    return await fetchTile(this, x, y, options);
  }

  // TiledMixin

  /** The number of tiles in the x and y directions */
  get tileCount(): [number, number] {
    return tileCount(this);
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
