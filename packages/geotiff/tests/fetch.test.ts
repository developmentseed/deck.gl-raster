/**
 * Tests for fetchTile's `boundless` option.
 *
 * Uses the unaligned fixture (265×266, 128×128 tiles) which has partial edge
 * tiles: right edge is 9px wide (265 % 128), bottom edge is 10px tall (266 % 128).
 */

import { describe, expect, it } from "vitest";
import { loadGeoTIFF } from "./helpers.js";

describe("fetchTile band-separate", () => {
  it("returns band-separate layout for a multi-band planar TIFF", async () => {
    const tiff = await loadGeoTIFF("int8_3band_zstd_block64", "rasterio");
    const tile = await tiff.fetchTile(0, 0);
    expect(tile.array.layout).toBe("band-separate");
    expect(tile.array.count).toBe(3);
    if (tile.array.layout === "band-separate") {
      expect(tile.array.bands).toHaveLength(3);
      for (const band of tile.array.bands) {
        expect(band.length).toBe(tiff.tileWidth * tiff.tileHeight);
      }
    }
  });

  it("returns correct tile dimensions", async () => {
    const tiff = await loadGeoTIFF("int8_3band_zstd_block64", "rasterio");
    const tile = await tiff.fetchTile(0, 0);
    expect(tile.array.width).toBe(tiff.tileWidth);
    expect(tile.array.height).toBe(tiff.tileHeight);
  });

  it("returns different data per band", async () => {
    const tiff = await loadGeoTIFF("int8_3band_zstd_block64", "rasterio");
    const tile = await tiff.fetchTile(0, 0);
    expect(tile.array.layout).toBe("band-separate");
    if (tile.array.layout === "band-separate") {
      const [b0, b1, b2] = tile.array.bands;
      expect(b0).not.toEqual(b1);
      expect(b0).not.toEqual(b2);
    }
  });
});

describe("fetchTile boundless option", () => {
  describe("boundless=true (default)", () => {
    it("returns the full tile dimensions for an interior tile", async () => {
      const tiff = await loadGeoTIFF(
        "uint8_1band_deflate_block128_unaligned",
        "rasterio",
      );
      const tile = await tiff.fetchTile(0, 0);
      expect(tile.array.width).toBe(tiff.tileWidth);
      expect(tile.array.height).toBe(tiff.tileHeight);
    });

    it("returns the full tile dimensions for an edge tile", async () => {
      const tiff = await loadGeoTIFF(
        "uint8_1band_deflate_block128_unaligned",
        "rasterio",
      );
      // x=2 is the right edge column (265 / 128 = 2.07 → 3 columns, last is partial)
      const tile = await tiff.fetchTile(2, 0);
      expect(tile.array.width).toBe(tiff.tileWidth);
      expect(tile.array.height).toBe(tiff.tileHeight);
    });
  });

  describe("boundless=false", () => {
    it("returns the full tile dimensions for an interior tile", async () => {
      const tiff = await loadGeoTIFF(
        "uint8_1band_deflate_block128_unaligned",
        "rasterio",
      );
      const tile = await tiff.fetchTile(0, 0, { boundless: false });
      expect(tile.array.width).toBe(tiff.tileWidth);
      expect(tile.array.height).toBe(tiff.tileHeight);
    });

    it("clips width for a right-edge tile", async () => {
      const tiff = await loadGeoTIFF(
        "uint8_1band_deflate_block128_unaligned",
        "rasterio",
      );
      const tile = await tiff.fetchTile(2, 0, { boundless: false });
      const expectedWidth = tiff.width % tiff.tileWidth; // 265 % 128 = 9
      expect(tile.array.width).toBe(expectedWidth);
      expect(tile.array.height).toBe(tiff.tileHeight);
    });

    it("clips height for a bottom-edge tile", async () => {
      const tiff = await loadGeoTIFF(
        "uint8_1band_deflate_block128_unaligned",
        "rasterio",
      );
      const tile = await tiff.fetchTile(0, 2, { boundless: false });
      const expectedHeight = tiff.height % tiff.tileHeight; // 266 % 128 = 10
      expect(tile.array.width).toBe(tiff.tileWidth);
      expect(tile.array.height).toBe(expectedHeight);
    });

    it("clips both dimensions for a corner tile", async () => {
      const tiff = await loadGeoTIFF(
        "uint8_1band_deflate_block128_unaligned",
        "rasterio",
      );
      const tile = await tiff.fetchTile(2, 2, { boundless: false });
      const expectedWidth = tiff.width % tiff.tileWidth; // 9
      const expectedHeight = tiff.height % tiff.tileHeight; // 10
      expect(tile.array.width).toBe(expectedWidth);
      expect(tile.array.height).toBe(expectedHeight);
    });

    it("data length matches clipped dimensions", async () => {
      const tiff = await loadGeoTIFF(
        "uint8_1band_deflate_block128_unaligned",
        "rasterio",
      );
      const tile = await tiff.fetchTile(2, 2, { boundless: false });
      const { array } = tile;
      const expectedPixels = array.width * array.height * array.count;
      if (array.layout === "pixel-interleaved") {
        expect(array.data.length).toBe(expectedPixels);
      } else {
        for (const band of array.bands) {
          expect(band.length).toBe(array.width * array.height);
        }
      }
    });
  });
});
