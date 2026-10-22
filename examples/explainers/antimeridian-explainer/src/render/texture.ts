import type { Device, Texture } from "@luma.gl/core";
import type { SourceImage } from "../scene/load.js";
import { rampColor } from "../scene/ramp.js";

/**
 * The image colored with the ramp, each pixel drawn as a `scale` x `scale`
 * block, so its 20 km pixels stay crisp under the texture's linear filtering.
 */
export function imageCanvas(
  image: SourceImage,
  scale: number,
): HTMLCanvasElement {
  const { width, height, values } = image;
  const small = document.createElement("canvas");
  small.width = width;
  small.height = height;
  const pixels = new ImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    pixels.data.set(rampColor(values[i]!), 4 * i);
  }
  small.getContext("2d")!.putImageData(pixels, 0, 0);
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(small, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Upload a canvas as a mipmapped, linearly filtered texture. Copied from the
 * reprojection explainer.
 *
 * Throws if the canvas is larger than the GPU's texture size limit.
 */
export function createImageTexture(
  device: Device,
  canvas: HTMLCanvasElement,
): Texture {
  const { width, height } = canvas;
  const limit = device.limits.maxTextureDimension2D;
  if (width > limit || height > limit) {
    throw new Error(
      `The image is ${width} x ${height} px, but this GPU only supports textures up to ${limit} px`,
    );
  }
  const texture = device.createTexture({
    data: canvas,
    width,
    height,
    mipLevels: device.getMipLevelCount(width, height),
    sampler: {
      minFilter: "linear",
      magFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    },
  });
  texture.generateMipmapsWebGL();
  return texture;
}
