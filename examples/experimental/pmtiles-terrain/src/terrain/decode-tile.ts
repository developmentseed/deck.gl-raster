import { terrariumToElevation } from "./terrarium.js";

/**
 * Swap the red and blue bytes of every RGBA pixel, in place. Turns the BGRA
 * pixels some `VideoFrame`s hold into RGBA.
 */
export function swapRedBlue(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i]!;
    pixels[i] = pixels[i + 2]!;
    pixels[i + 2] = red;
  }
}

/** Whether canvas reads return altered pixels; checked once, on first use. */
let canvasDistorted: boolean | undefined;

/** Reused for every tile, as MapLibre does. */
let canvasContext: OffscreenCanvasRenderingContext2D | null | undefined;

/** Whether `VideoFrame` reads have failed, so the warning shows once. */
let warnedVideoFrameFailed = false;

/**
 * Whether this browser adds noise to canvas reads, as some do to resist
 * fingerprinting. Draws a known 5 x 5 pattern and reads it back, following
 * MapLibre's `isOffscreenCanvasDistorted`.
 */
function isCanvasDistorted(): boolean {
  if (canvasDistorted === undefined) {
    canvasDistorted = false;
    const size = 5;
    const context = new OffscreenCanvas(size, size).getContext("2d", {
      willReadFrequently: true,
    });
    if (context) {
      // Each pixel's RGB bytes are its own byte offsets: 0, 1, 2, then 4, 5, 6...
      for (let i = 0; i < size * size; i++) {
        const base = i * 4;
        context.fillStyle = `rgb(${base},${base + 1},${base + 2})`;
        context.fillRect(i % size, Math.floor(i / size), 1, 1);
      }
      const data = context.getImageData(0, 0, size, size).data;
      for (let i = 0; i < data.length; i++) {
        if (i % 4 !== 3 && data[i] !== i) {
          canvasDistorted = true;
          break;
        }
      }
    }
  }
  return canvasDistorted;
}

/** Read a bitmap's pixels with WebCodecs, which canvas noise can't reach. */
async function readWithVideoFrame(
  bitmap: ImageBitmap,
): Promise<Uint8ClampedArray> {
  const { width, height } = bitmap;
  const frame = new VideoFrame(bitmap, { timestamp: 0 });
  try {
    const format = frame.format;
    if (!format || !(format.startsWith("RGB") || format.startsWith("BGR"))) {
      throw new Error(`Unrecognized VideoFrame format ${format}`);
    }
    const pixels = new Uint8ClampedArray(width * height * 4);
    await frame.copyTo(pixels, {
      rect: { x: 0, y: 0, width, height },
      layout: [{ offset: 0, stride: width * 4 }],
    });
    if (format.startsWith("BGR")) {
      swapRedBlue(pixels);
    }
    return pixels;
  } finally {
    frame.close();
  }
}

/** Read a bitmap's pixels through a 2D canvas. */
function readWithCanvas(bitmap: ImageBitmap): Uint8ClampedArray {
  const { width, height } = bitmap;
  if (canvasContext === undefined) {
    canvasContext = new OffscreenCanvas(width, height).getContext("2d", {
      willReadFrequently: true,
    });
  }
  if (!canvasContext) {
    throw new Error("OffscreenCanvas has no 2D context to read tiles with");
  }
  const { canvas } = canvasContext;
  // Resizing also clears it.
  canvas.width = width;
  canvas.height = height;
  canvasContext.drawImage(bitmap, 0, 0);
  return canvasContext.getImageData(0, 0, width, height).data;
}

/**
 * Read a bitmap's exact RGBA bytes, the way MapLibre reads DEM tiles: through
 * a canvas, unless the browser distorts canvas reads; then through
 * `VideoFrame.copyTo`, falling back to the canvas if that fails.
 */
async function readPixels(bitmap: ImageBitmap): Promise<Uint8ClampedArray> {
  if (isCanvasDistorted() && typeof VideoFrame !== "undefined") {
    try {
      return await readWithVideoFrame(bitmap);
    } catch (error) {
      if (!warnedVideoFrameFailed) {
        warnedVideoFrameFailed = true;
        console.warn(
          "This browser alters canvas reads, and VideoFrame failed too, so elevations may be off.",
          error,
        );
      }
    }
  }
  return readWithCanvas(bitmap);
}

/**
 * Decode one Terrarium-encoded image tile to elevations in meters.
 *
 * The browser decodes the image off the main thread without premultiplying
 * alpha or converting color spaces, so the bytes stay exact. Reading the
 * pixels back and converting them runs on the main thread and is recorded as
 * the `terrarium-decode` performance measure.
 *
 * @param bytes - The encoded tile.
 * @param options.tileSize - The expected width and height, in pixels.
 * @param options.mimeType - The image type, such as `image/webp`.
 * @returns One elevation per pixel, row-major from the top-left.
 * @throws If the image isn't `tileSize` pixels square.
 */
export async function decodeTerrariumTile(
  bytes: ArrayBuffer,
  options: { tileSize: number; mimeType: string },
): Promise<Float32Array> {
  const { tileSize, mimeType } = options;
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: mimeType }),
    { premultiplyAlpha: "none", colorSpaceConversion: "none" },
  );
  try {
    if (bitmap.width !== tileSize || bitmap.height !== tileSize) {
      throw new Error(
        `Expected a ${tileSize} px tile, got ${bitmap.width} x ${bitmap.height}`,
      );
    }
    const start = performance.now();
    const elevation = terrariumToElevation(await readPixels(bitmap));
    performance.measure("terrarium-decode", { start, end: performance.now() });
    return elevation;
  } finally {
    bitmap.close();
  }
}
