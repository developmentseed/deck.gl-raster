import type { UvTransform } from "@developmentseed/deck.gl-raster";
import type { RasterArray } from "@developmentseed/geotiff";

/**
 * Where a point of the primary tile lands in a band's texture, in texels:
 * `uv * scale + offset`, as the shader computes it, times the texture size.
 */
export function textureTexel(
  uv: [number, number],
  uvTransform: UvTransform,
  size: [number, number],
): [number, number] {
  const [offsetX, offsetY, scaleX, scaleY] = uvTransform;
  return [
    (uv[0] * scaleX + offsetX) * size[0],
    (uv[1] * scaleY + offsetY) * size[1],
  ];
}

/**
 * Sample a single-band array at a point in texels, the way the GPU's linear
 * filter does: texel centres sit at +0.5, and the edges clamp.
 */
export function sampleBilinear(
  array: RasterArray,
  texel: [number, number],
): number {
  if (array.layout !== "pixel-interleaved") {
    throw new Error("Expected a pixel-interleaved array");
  }
  const { data, width, height } = array;
  const x = texel[0] - 0.5;
  const y = texel[1] - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (col: number, row: number) => {
    const c = Math.min(width - 1, Math.max(0, col));
    const r = Math.min(height - 1, Math.max(0, row));
    return data[r * width + c]!;
  };
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}
