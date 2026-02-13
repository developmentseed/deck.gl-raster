import type { Compression, TiffImage, TiffMimeType } from "@cogeotiff/core";
import type { Affine } from "@developmentseed/affine";
import { compose, scale } from "@developmentseed/affine";
import type { GeoTIFF } from "./geotiff";
import type { GeoKeyDirectory } from "./ifd";

/** Options for fetching tile/raster data. */
export type FetchOptions = {
  /** AbortSignal to cancel the fetch operation. */
  signal?: AbortSignal;
};

/** Raw tile bytes returned by fetchTile before any decoding. */
export type TileBytes = {
  /** Tile column index. */
  x: number;
  /** Tile row index. */
  y: number;
  /** Compressed tile bytes. */
  bytes: ArrayBuffer;
  /** MIME type of the compressed data (e.g. "image/jpeg"). */
  mimeType: TiffMimeType;
  /** Compression enum value. */
  compression: Compression;
};

/**
 * A single resolution level of a GeoTIFF — either the full-resolution image
 * or a reduced-resolution overview.  Pairs the data IFD with its
 * corresponding mask IFD (if any).
 */
export class Overview {
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
  ) {
    this.geotiff = geotiff;
    this.gkd = gkd;
    this.image = image;
    this.maskImage = maskImage;
  }

  get crs(): string {
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

    const overviewWidth = this.width;
    const fullWidth = this.geotiff.width;
    const overviewHeight = this.height;
    const fullHeight = this.geotiff.height;

    const scaleX = fullWidth / overviewWidth;
    const scaleY = fullHeight / overviewHeight;
    return compose(fullTransform, scale(scaleX, scaleY));
  }

  get width(): number {
    return this.image.size.width;
  }
}
