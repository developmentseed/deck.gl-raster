import type { DecodedPixels, DecoderMetadata } from "../decode.js";

// TODO: in the future, have an API that returns an ImageBitmap directly from
// the decoder, to avoid copying pixel data from GPU -> CPU memory
// Then deck.gl could use the ImageBitmap directly as a texture source without
// copying again from CPU -> GPU memory
// https://github.com/developmentseed/deck.gl-raster/issues/228
export async function decode(
  bytes: ArrayBuffer,
  metadata: DecoderMetadata,
): Promise<DecodedPixels> {
  const blob = new Blob([bytes]);
  const imageBitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const rgba = imageData.data;

  const samplesPerPixel = metadata.samplesPerPixel;
  if (samplesPerPixel === 4) {
    return { layout: "pixel-interleaved", data: rgba };
  }

  if (samplesPerPixel === 3) {
    const pixelCount = width * height;
    const rgb = new Uint8ClampedArray(pixelCount * 3);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      rgb[i] = rgba[j]!;
      rgb[i + 1] = rgba[j + 1]!;
      rgb[i + 2] = rgba[j + 2]!;
    }
    return { layout: "pixel-interleaved", data: rgb };
  }

  throw new Error(`Unsupported SamplesPerPixel for JPEG: ${samplesPerPixel}`);
}
