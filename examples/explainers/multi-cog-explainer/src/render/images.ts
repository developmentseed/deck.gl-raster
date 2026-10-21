import type { RasterArray } from "@developmentseed/geotiff";
import type { BandId } from "../scene/constants.js";

/** Values mapped to black (`min`) and white (`max`). */
export type StretchRange = { min: number; max: number };

/** Contrast stretch per band, for the grayscale images. */
export const BAND_RANGES: Record<BandId, StretchRange> = {
  b04: { min: 0, max: 4000 },
  b11: { min: 0, max: 4000 },
  b01: { min: 0, max: 4000 },
};

/** A rectangle in pixels. */
export type PixelRect = { x: number; y: number; width: number; height: number };

/** Map 16-bit values linearly onto 0-255, clamping outside the range. */
export function stretchToBytes(
  data: Uint16Array,
  range: StretchRange,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  const scale = 255 / (range.max - range.min);
  for (let i = 0; i < data.length; i++) {
    // Uint8ClampedArray rounds and clamps on assignment.
    out[i] = (data[i]! - range.min) * scale;
  }
  return out;
}

/** The array's single band, as 16-bit values. */
function band16(array: RasterArray): Uint16Array {
  if (array.layout !== "pixel-interleaved" || array.count !== 1) {
    throw new Error("Expected a single-band, pixel-interleaved array");
  }
  if (!(array.data instanceof Uint16Array)) {
    throw new Error("Expected 16-bit samples");
  }
  return array.data;
}

/** Draw 0-255 values into an opaque grayscale canvas. */
function bytesToCanvas(
  bytes: Uint8ClampedArray,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const image = new ImageData(width, height);
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i]!;
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  return canvas;
}

/** A band's array as a grayscale canvas. */
export function grayscaleCanvas(
  array: RasterArray,
  range: StretchRange,
): HTMLCanvasElement {
  return bytesToCanvas(
    stretchToBytes(band16(array), range),
    array.width,
    array.height,
  );
}

/** A rectangle of a band's array as a grayscale canvas, for the insets. */
export function cropCanvas(
  array: RasterArray,
  rect: PixelRect,
  range: StretchRange,
): HTMLCanvasElement {
  const data = band16(array);
  const crop = new Uint16Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row++) {
    const start = (rect.y + row) * array.width + rect.x;
    crop.set(data.subarray(start, start + rect.width), row * rect.width);
  }
  return bytesToCanvas(stretchToBytes(crop, range), rect.width, rect.height);
}
