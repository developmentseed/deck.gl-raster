import type { GeoTransform } from "@developmentseed/raster-reproject/affine";
import type { GeoTIFFImage, TypedArrayWithDimensions } from "geotiff";
import { defaultPool } from "../geotiff.js";
import type { RasterArray } from "./array.js";
import type { FetchOptions } from "./options.js";
import type { Tile } from "./tile.js";
import type { Window } from "./window.js";

/**
 * A single resolution level of a GeoTIFF — either the full-resolution image or
 * an overview.  Pairs the data IFD with its corresponding mask IFD (if any).
 */
export class Overview {
  /** The data IFD for this resolution level. */
  readonly image: GeoTIFFImage;
  /** The mask IFD, or null when no mask exists at this level. */
  readonly maskImage: GeoTIFFImage | null;
  /** Affine geotransform for this overview's pixel grid. */
  readonly transform: GeoTransform;
  /** Image width in pixels. */
  readonly width: number;
  /** Image height in pixels. */
  readonly height: number;
  /** Tile width in pixels (equals image width when the image is not tiled). */
  readonly tileWidth: number;
  /** Tile height in pixels (equals image height when the image is not tiled). */
  readonly tileHeight: number;

  constructor(
    image: GeoTIFFImage,
    maskImage: GeoTIFFImage | null,
    transform: GeoTransform,
  ) {
    this.image = image;
    this.maskImage = maskImage;
    this.transform = transform;
    this.width = image.getWidth();
    this.height = image.getHeight();
    this.tileWidth = image.isTiled ? image.getTileWidth() : this.width;
    this.tileHeight = image.isTiled ? image.getTileHeight() : this.height;
  }

  /**
   * Fetch a single tile by its grid indices.
   *
   * Edge tiles (at the right or bottom of the image) are clamped to the image
   * bounds and will be smaller than tileWidth × tileHeight.
   */
  async fetchTile(
    x: number,
    y: number,
    options?: FetchOptions,
  ): Promise<Tile> {
    const left = x * this.tileWidth;
    const top = y * this.tileHeight;
    const right = Math.min(left + this.tileWidth, this.width);
    const bottom = Math.min(top + this.tileHeight, this.height);

    const array = await this._readRegion(left, top, right, bottom, options);

    return { x, y, array };
  }

  /**
   * Read an arbitrary rectangular window of pixel data.
   *
   * The window is in pixel coordinates of this overview's image.
   */
  async read(window: Window, options?: FetchOptions): Promise<RasterArray> {
    const resolvedPool = options?.pool ?? defaultPool();

    const left = window.colOff;
    const top = window.rowOff;
    const right = left + window.width;
    const bottom = top + window.height;

    if (right > this.width || bottom > this.height) {
      throw new Error(
        `Window extends outside image bounds. ` +
          `Window: cols=${left}:${right}, rows=${top}:${bottom}. ` +
          `Image size: ${this.height}x${this.width}`,
      );
    }

    return this._readRegion(left, top, right, bottom, options);
  }

  /**
   * Core read: fetches data (and mask in parallel if present) for the given
   * pixel rectangle, and assembles a RasterArray.
   */
  private async _readRegion(
    left: number,
    top: number,
    right: number,
    bottom: number,
    options?: FetchOptions,
  ): Promise<RasterArray> {
    const pool = options?.pool ?? defaultPool();
    const signal = options?.signal;
    // geotiff.js window: [left, top, right, bottom] in pixel coordinates
    const window: [number, number, number, number] = [left, top, right, bottom];

    const dataPromise = this.image.readRasters({
      window,
      interleave: true,
      pool,
      signal,
    }) as Promise<TypedArrayWithDimensions>;

    const maskPromise = this.maskImage
      ? (this.maskImage.readRasters({
          window,
          interleave: true,
          pool,
          signal,
        }) as Promise<TypedArrayWithDimensions>)
      : null;

    const [dataResult, maskResult] = await Promise.all([
      dataPromise,
      maskPromise,
    ]);

    const height = dataResult.height;
    const width = dataResult.width;
    const bands = this.image.getSamplesPerPixel();

    // Compute the affine transform for this region by translating the overview
    // transform by the pixel offset: transform * translate(left, top)
    // For [a, b, c, d, e, f]:
    //   new_c = a * left + b * top + c
    //   new_f = d * left + e * top + f
    const [a, b, c, d, e, f] = this.transform;
    const regionTransform: GeoTransform = [
      a,
      b,
      a * left + b * top + c,
      d,
      e,
      d * left + e * top + f,
    ];

    // Mask is single-band; convert to Uint8Array validity mask (1=valid, 0=nodata)
    let mask: Uint8Array | null = null;
    if (maskResult) {
      mask = new Uint8Array(height * width);
      for (let i = 0; i < mask.length; i++) {
        mask[i] = maskResult[i]! !== 0 ? 1 : 0;
      }
    }

    return {
      data: dataResult,
      mask,
      bands,
      height,
      width,
      transform: regionTransform,
    };
  }
}
