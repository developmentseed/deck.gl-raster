import { parseColormap } from "@developmentseed/geotiff";
import type { Device, Texture } from "@luma.gl/core";

/**
 * Build a 256×1 `rgba8unorm` colormap texture from a GeoTIFF `ColorMap`
 * tag. The nodata index has alpha=0 (handled by `parseColormap`), so
 * nodata pixels render as transparent without a separate filter module.
 */
export function buildColormapTexture(
  device: Device,
  options: { colorMap: Uint16Array; nodata: number | null },
): Texture {
  const { colorMap, nodata } = options;
  const imageData = parseColormap(colorMap, nodata ?? undefined);
  return device.createTexture({
    data: imageData.data,
    format: "rgba8unorm",
    width: imageData.width,
    height: imageData.height,
    sampler: {
      minFilter: "nearest",
      magFilter: "nearest",
    },
  });
}
