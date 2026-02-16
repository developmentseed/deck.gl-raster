import type { Affine } from "@developmentseed/affine";
import type { ProjJson } from "./crs.js";

/** Typed arrays supported for raster sample storage. */
export type RasterTypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

/** Common metadata shared by all raster layouts. */
type RasterArrayBase = {
  /** Number of bands (samples per pixel). */
  count: number;

  /** Height in pixels. */
  height: number;

  /** Width in pixels. */
  width: number;

  /**
   * Optional validity mask.  Length = height * width.
   * 1 = valid pixel, 0 = nodata.  null when no mask IFD is present.
   */
  mask: Uint8Array | null;

  /**
   * Affine geotransform [a, b, c, d, e, f] mapping pixel (col, row) to
   * geographic (x, y):
   *   x = a * col + b * row + c
   *   y = d * col + e * row + f
   */
  transform: Affine;

  crs: ProjJson;

  nodata: number | null;
};

/** Raster stored in one typed array per band (band-major / planar). */
export type BandRasterArray = RasterArrayBase & {
  layout: "band-separate";
  /**
   * One typed array per band, each length = width * height.
   *
   * This is the preferred representation when uploading one texture per band.
   */
  bands: RasterTypedArray[];
};

/** Raster stored in one pixel-interleaved typed array. */
export type PixelRasterArray = RasterArrayBase & {
  layout: "pixel-interleaved";
  /**
   * Pixel-interleaved raster data:
   * [p00_band0, p00_band1, ..., p01_band0, ...]
   *
   * Length = width * height * count.
   */
  data: RasterTypedArray;
};

/** Decoded raster data from a GeoTIFF region. */
export type RasterArray = BandRasterArray | PixelRasterArray;

/** Options for packing band data to a 4-channel pixel-interleaved array. */
export type PackBandsToRGBAOptions = {
  /**
   * Source band index for each RGBA output channel.
   * Use null to write `fillValue` for that output channel.
   */
  order?: [number | null, number | null, number | null, number | null];
  /** Fill value used when an output channel has no source band. */
  fillValue?: number;
};

/** Convert any raster layout to a band-separate representation. */
export function toBandSeparate(array: RasterArray): BandRasterArray {
  validateRasterShape(array);
  if (array.layout === "band-separate") {
    return array;
  }

  const sampleCount = array.width * array.height;
  const bands: RasterTypedArray[] = new Array(array.count);
  const Ctor = array.data.constructor as new (
    length: number,
  ) => RasterTypedArray;

  for (let b = 0; b < array.count; b++) {
    bands[b] = new Ctor(sampleCount);
  }

  for (let i = 0; i < sampleCount; i++) {
    const base = i * array.count;
    for (let b = 0; b < array.count; b++) {
      bands[b]![i] = array.data[base + b]!;
    }
  }

  return {
    ...array,
    layout: "band-separate",
    bands,
  };
}

/** Convert any raster layout to a pixel-interleaved representation. */
export function toPixelInterleaved(
  array: RasterArray,
  order?: readonly number[],
): PixelRasterArray {
  validateRasterShape(array);

  const defaultOrder = Array.from({ length: array.count }, (_, i) => i);
  const bandOrder = order ?? defaultOrder;
  validateBandOrder(bandOrder, array.count);

  const sampleCount = array.width * array.height;

  if (array.layout === "pixel-interleaved" && isIdentityOrder(bandOrder)) {
    return array;
  }

  const Ctor = (
    array.layout === "pixel-interleaved"
      ? array.data.constructor
      : array.bands[0]!.constructor
  ) as new (
    length: number,
  ) => RasterTypedArray;

  const data = new Ctor(sampleCount * bandOrder.length);
  const bandSource = toBandSeparate(array).bands;

  for (let i = 0; i < sampleCount; i++) {
    const outBase = i * bandOrder.length;
    for (let c = 0; c < bandOrder.length; c++) {
      data[outBase + c] = bandSource[bandOrder[c]!]![i]!;
    }
  }

  return {
    ...array,
    layout: "pixel-interleaved",
    count: bandOrder.length,
    data,
  };
}

/** Reorder bands while keeping a band-separate representation. */
export function reorderBands(
  array: RasterArray,
  order: readonly number[],
): BandRasterArray {
  validateRasterShape(array);
  validateBandOrder(order, array.count);
  const src = toBandSeparate(array);
  return {
    ...src,
    count: order.length,
    bands: order.map((bandIndex) => src.bands[bandIndex]!),
  };
}

/**
 * Pack selected source bands into an RGBA pixel-interleaved typed array.
 *
 * This is useful as a fallback path when a single 4-channel texture upload
 * is preferred over one texture per band.
 */
export function packBandsToRGBA(
  array: RasterArray,
  options: PackBandsToRGBAOptions = {},
): PixelRasterArray {
  const order = options.order ?? [0, 1, 2, null];
  const fillValue = options.fillValue ?? 0;

  validateRasterShape(array);
  const src = toBandSeparate(array);
  const sampleCount = src.width * src.height;
  const Ctor = src.bands[0]!.constructor as new (
    length: number,
  ) => RasterTypedArray;
  const data = new Ctor(sampleCount * 4);

  for (let i = 0; i < sampleCount; i++) {
    const outBase = i * 4;
    for (let c = 0; c < 4; c++) {
      const bandIndex = order[c]!;
      data[outBase + c] =
        bandIndex == null ? fillValue : src.bands[bandIndex]![i]!;
    }
  }

  return {
    ...src,
    layout: "pixel-interleaved",
    count: 4,
    data,
  };
}

function validateBandOrder(order: readonly number[], count: number): void {
  if (order.length === 0) {
    throw new Error("Band order must include at least one channel");
  }

  for (const bandIndex of order) {
    if (!Number.isInteger(bandIndex)) {
      throw new Error(`Band index must be an integer: ${String(bandIndex)}`);
    }
    if (bandIndex < 0 || bandIndex >= count) {
      throw new Error(
        `Band index ${bandIndex} is out of range for ${count} band(s)`,
      );
    }
  }
}

function validateRasterShape(array: RasterArray): void {
  if (array.width <= 0 || array.height <= 0) {
    throw new Error("Raster width and height must be positive");
  }
  if (array.count <= 0) {
    throw new Error("Raster count must be positive");
  }

  const sampleCount = array.width * array.height;
  const expectedMaskLength = sampleCount;

  if (array.mask != null && array.mask.length !== expectedMaskLength) {
    throw new Error(
      `Mask length ${array.mask.length} does not match width * height (${expectedMaskLength})`,
    );
  }

  if (array.layout === "band-separate") {
    if (array.bands.length !== array.count) {
      throw new Error(
        `Band count mismatch: bands.length=${array.bands.length}, count=${array.count}`,
      );
    }
    for (const [index, band] of array.bands.entries()) {
      if (band.length !== sampleCount) {
        throw new Error(
          `Band ${index} length ${band.length} does not match width * height (${sampleCount})`,
        );
      }
    }
    return;
  }

  const expectedDataLength = sampleCount * array.count;
  if (array.data.length !== expectedDataLength) {
    throw new Error(
      `Data length ${array.data.length} does not match width * height * count (${expectedDataLength})`,
    );
  }
}

function isIdentityOrder(order: readonly number[]): boolean {
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== i) return false;
  }
  return true;
}
