import type { Device, Texture } from "@luma.gl/core";

/** A line drawn into the texture, in source pixel coordinates. */
export type BakedLine = {
  /** Points in source pixels. */
  points: [number, number][];
  /** CSS colour. */
  color: string;
  /** Width in source pixels. */
  width: number;
};

/** Load an image from a URL. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image ${url}`));
    image.src = url;
  });
}

/**
 * Draw the source image over an opaque background, with lines baked in.
 *
 * Lines baked into the texture warp exactly the way the GPU warps the image,
 * and the opaque background avoids dark fringes along nodata edges.
 */
export function composeTexture(
  image: HTMLImageElement,
  options: { background: string; lines: BakedLine[] },
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a 2D canvas context");
  }
  context.fillStyle = options.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const line of options.lines) {
    context.strokeStyle = line.color;
    context.lineWidth = line.width;
    context.beginPath();
    line.points.forEach(([x, y], i) => {
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();
  }
  return canvas;
}

/**
 * Upload a canvas as a mipmapped, linearly filtered texture.
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
      `The image is ${width}×${height} px, but this GPU only supports textures up to ${limit} px`,
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
