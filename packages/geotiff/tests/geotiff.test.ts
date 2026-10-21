import { describe, expect, it } from "vitest";
import { loadGeoTIFF } from "./helpers.js";

// Each expected box is rasterio's, from the fixture's `_info.md`.
describe("GeoTIFF.bbox", () => {
  it("bounds a north-up image", async () => {
    // 265x266 px, so a swapped width and height would show.
    const geotiff = await loadGeoTIFF(
      "uint8_1band_deflate_block128_unaligned",
      "rasterio",
    );
    expect(geotiff.bbox).toEqual([373185, 8259415, 399685, 8286015]);
  });

  it("bounds all four corners of a rotated image", async () => {
    // Rotated 20°: its corners are (-204, 24), (-164.5, 38.4), (-150.2, -1.1)
    // and (-189.6, -15.5).
    const geotiff = await loadGeoTIFF("antimeridian_rotated", "rasterio");
    const [minX, minY, maxX, maxY] = geotiff.bbox;
    expect(minX).toBeCloseTo(-204, 9);
    expect(minY).toBeCloseTo(-15.467090073008151, 9);
    expect(maxX).toBeCloseTo(-150.16806390731375, 9);
    expect(maxY).toBeCloseTo(38.36484601967808, 9);
  });

  it("bounds the pixel edges of a PixelIsPoint image", async () => {
    // Its tiepoint is the center of the top-left pixel, half a pixel in.
    const geotiff = await loadGeoTIFF("pixel_as_point", "rasterio");
    expect(geotiff.bbox).toEqual([-180, -18, -138, 24]);
  });
});
