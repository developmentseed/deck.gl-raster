/**
 * Parse the GeoTIFF `ColorMap` tag into an ImageData.
 *
 * @param cmap  The colormap array from the GeoTIFF `ColorMap` tag.
 * @param nodata  Optional index of the nodata value in the colormap.
 *
 * @return The parsed colormap as an ImageData object.
 */
export function parseColormap(cmap: Uint16Array, nodata?: number): ImageData {
  // TODO: test colormap handling on a 16-bit image with 2^16 entries?
  const size = cmap.length / 3;
  const rgba = new Uint8ClampedArray(size * 4);

  const rOffset = 0;
  const gOffset = size;
  const bOffset = size * 2;

  // Note: >> 8 is needed to convert from 16-bit to 8-bit color values
  // It just divides by 256 and floors to nearest integer
  for (let i = 0; i < size; i++) {
    rgba[4 * i + 0] = cmap[rOffset + i]! >> 8;
    rgba[4 * i + 1] = cmap[gOffset + i]! >> 8;
    rgba[4 * i + 2] = cmap[bOffset + i]! >> 8;

    // Full opacity
    rgba[4 * i + 3] = 255;
  }

  if (nodata !== undefined) {
    // Set nodata value to be fully transparent
    rgba[4 * nodata + 3] = 0;
  }

  return new ImageData(rgba, size, 1);
}
