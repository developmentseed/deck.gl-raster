import type { DecodedPixels, DecoderMetadata } from "../decode.js";

export async function decode(
  bytes: ArrayBuffer,
  metadata: DecoderMetadata,
): Promise<DecodedPixels> {
  const blob = new Blob([bytes]);
  const { clippedWidth, clippedHeight, width, height } = metadata;
  const needsClip = clippedWidth !== width || clippedHeight !== height;
  const imageBitmap = needsClip
    ? await createImageBitmap(blob, 0, 0, clippedWidth, clippedHeight)
    : await createImageBitmap(blob);
  return { layout: "image-bitmap", data: imageBitmap };
}
