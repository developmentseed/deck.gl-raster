import type { Compression, TiffImage, TiffMimeType } from "@cogeotiff/core";
import type { Affine } from "./affine.js";

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
  /** The data IFD for this resolution level. */
  readonly image: TiffImage;
  /** The mask IFD, or null when no mask exists at this level. */
  readonly maskImage: TiffImage | null;
  /** Affine geotransform for this overview's pixel grid. */
  readonly transform: Affine;
  /** Image width in pixels. */
  readonly width: number;
  /** Image height in pixels. */
  readonly height: number;
  /** Tile width in pixels (equals image width when the image is not tiled). */
  readonly tileWidth: number;
  /** Tile height in pixels (equals image height when the image is not tiled). */
  readonly tileHeight: number;

  constructor(
    image: TiffImage,
    maskImage: TiffImage | null,
    transform: Affine,
  ) {
    this.image = image;
    this.maskImage = maskImage;
    this.transform = transform;

    const size = image.size;
    this.width = size.width;
    this.height = size.height;

    if (image.isTiled()) {
      const ts = image.tileSize;
      this.tileWidth = ts.width;
      this.tileHeight = ts.height;
    } else {
      this.tileWidth = this.width;
      this.tileHeight = this.height;
    }
  }

  /**
   * Fetch a single tile's raw compressed bytes by its grid indices.
   *
   * Returns null if the tile has no data (sparse COG).
   */
  async fetchTile(
    x: number,
    y: number,
    _options?: FetchOptions,
  ): Promise<TileBytes | null> {
    const result = await this.image.getTile(x, y);
    if (result == null) return null;

    return {
      x,
      y,
      bytes: result.bytes,
      mimeType: result.mimeType,
      compression: result.compression,
    };
  }

  /**
   * Fetch data and mask tiles in parallel for the given grid position.
   *
   * Returns null if the data tile has no data (sparse COG).
   */
  async fetchTileWithMask(
    x: number,
    y: number,
    _options?: FetchOptions,
  ): Promise<{
    data: TileBytes;
    mask: TileBytes | null;
  } | null> {
    const dataPromise = this.image.getTile(x, y);
    const maskPromise = this.maskImage ? this.maskImage.getTile(x, y) : null;

    const [dataResult, maskResult] = await Promise.all([
      dataPromise,
      maskPromise,
    ]);

    if (dataResult == null) return null;

    const dataTile: TileBytes = {
      x,
      y,
      bytes: dataResult.bytes,
      mimeType: dataResult.mimeType,
      compression: dataResult.compression,
    };

    let maskTile: TileBytes | null = null;
    if (maskResult != null) {
      maskTile = {
        x,
        y,
        bytes: maskResult.bytes,
        mimeType: maskResult.mimeType,
        compression: maskResult.compression,
      };
    }

    return { data: dataTile, mask: maskTile };
  }
}
