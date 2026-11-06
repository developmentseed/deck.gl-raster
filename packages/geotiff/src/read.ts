import type { Affine } from "@developmentseed/affine";
import { compose, translation } from "@developmentseed/affine";
import type { RasterArray, RasterTypedArray } from "./array.js";
import { assembleTiles } from "./assemble.js";
import type { DecoderPool } from "./pool/pool.js";
import type { Tile } from "./tile.js";
import type { HasTransform } from "./transform.js";
import type { Window } from "./window.js";
import { WindowError } from "./window.js";

/** An image that {@link read} can read from: a GeoTIFF or an Overview. */
interface CanFetchTiles extends HasTransform {
  /** Image width in pixels. */
  readonly width: number;
  /** Image height in pixels. */
  readonly height: number;
  /** Tile width in pixels. */
  readonly tileWidth: number;
  /** Tile height in pixels. */
  readonly tileHeight: number;
  /** Fetch tiles of the image, as `GeoTIFF.fetchTiles` does. */
  fetchTiles(
    xy: Array<[number, number]>,
    options: { boundless?: boolean; pool?: DecoderPool; signal?: AbortSignal },
  ): Promise<Tile[]>;
}

/**
 * Read the pixels of a window of an image.
 *
 * Fetches every tile that the window touches, stitches them together with
 * {@link assembleTiles}, and keeps only the pixels inside the window.
 *
 * @param self - The GeoTIFF or Overview to read from.
 * @param options.window - The pixel region to read. Defaults to the whole
 *   image.
 * @param options.pool - An optional {@link DecoderPool} for decoding the tile
 *   data.
 * @param options.signal - An optional {@link AbortSignal} to cancel the
 *   fetches.
 * @returns A {@link RasterArray} of the window's pixels.
 * @throws A {@link WindowError} if the window is invalid or extends outside
 *   the image.
 */
export async function read(
  self: CanFetchTiles,
  {
    window = { colOff: 0, rowOff: 0, width: self.width, height: self.height },
    pool,
    signal,
  }: { window?: Window; pool?: DecoderPool; signal?: AbortSignal } = {},
): Promise<RasterArray> {
  validateWindow(self, window);
  const { colOff, rowOff, width, height } = window;
  const { tileWidth, tileHeight } = self;

  // The range of tiles that the window touches.
  const minCol = Math.floor(colOff / tileWidth);
  const minRow = Math.floor(rowOff / tileHeight);
  const maxCol = Math.floor((colOff + width - 1) / tileWidth);
  const maxRow = Math.floor((rowOff + height - 1) / tileHeight);
  const xy: Array<[number, number]> = [];
  for (let y = minRow; y <= maxRow; y++) {
    for (let x = minCol; x <= maxCol; x++) {
      xy.push([x, y]);
    }
  }

  // Clip edge tiles to the image, which is how assembleTiles expects them.
  const tiles = await self.fetchTiles(xy, { boundless: false, pool, signal });
  const left = minCol * tileWidth;
  const top = minRow * tileHeight;
  const covered = assembleTiles(tiles, {
    width: Math.min((maxCol + 1) * tileWidth, self.width) - left,
    height: Math.min((maxRow + 1) * tileHeight, self.height) - top,
    tileWidth,
    tileHeight,
    minCol,
    minRow,
  });

  return cropArray(
    covered,
    { colOff: colOff - left, rowOff: rowOff - top, width, height },
    compose(self.transform, translation(colOff, rowOff)),
  );
}

/**
 * Throw a {@link WindowError} unless `window` has integer offsets and sizes,
 * and lies inside the image.
 */
function validateWindow(
  image: { width: number; height: number },
  window: Window,
): void {
  const { colOff, rowOff, width, height } = window;
  if (
    !Number.isInteger(colOff) ||
    !Number.isInteger(rowOff) ||
    colOff < 0 ||
    rowOff < 0
  ) {
    throw new WindowError(
      `Window offsets must be non-negative integers, got colOff=${colOff}, rowOff=${rowOff}`,
    );
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new WindowError(
      `Window width and height must be positive integers, got width=${width}, height=${height}`,
    );
  }
  if (colOff + width > image.width || rowOff + height > image.height) {
    throw new WindowError(
      `Window extends outside image bounds: cols ${colOff}:${colOff + width}, ` +
        `rows ${rowOff}:${rowOff + height} of a ${image.width}x${image.height} image`,
    );
  }
}

/**
 * Crop `array` to `window`, given in `array`'s pixel coordinates. Copies no
 * pixels when the window covers all of `array`, as when reading a whole image.
 *
 * @param transform The transform of the window's top-left pixel.
 */
function cropArray(
  array: RasterArray,
  window: Window,
  transform: Affine,
): RasterArray {
  const { colOff, rowOff, width, height } = window;
  if (
    colOff === 0 &&
    rowOff === 0 &&
    width === array.width &&
    height === array.height
  ) {
    return { ...array, transform };
  }

  const crop = <T extends RasterTypedArray>(
    src: T,
    samplesPerPixel: number,
  ): T => {
    const srcStride = array.width * samplesPerPixel;
    const dstStride = width * samplesPerPixel;
    const Ctor = src.constructor as new (length: number) => T;
    const dst = new Ctor(dstStride * height);
    for (let row = 0; row < height; row++) {
      const start = (rowOff + row) * srcStride + colOff * samplesPerPixel;
      dst.set(src.subarray(start, start + dstStride), row * dstStride);
    }
    return dst;
  };

  const meta = {
    width,
    height,
    mask: array.mask === null ? null : crop(array.mask, 1),
    transform,
  };
  if (array.layout === "pixel-interleaved") {
    return { ...array, ...meta, data: crop(array.data, array.count) };
  }
  return { ...array, ...meta, bands: array.bands.map((b) => crop(b, 1)) };
}
