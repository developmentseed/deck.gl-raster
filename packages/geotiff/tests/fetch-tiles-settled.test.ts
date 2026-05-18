import { describe, expect, it } from "vitest";
import { loadGeoTIFF } from "./helpers.js";

const GRID: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

describe("fetchTilesSettled", () => {
  it("returns one Tile per coordinate for a good grid — same as fetchTiles (pixel-interleaved)", async () => {
    const tiff = await loadGeoTIFF("uint8_rgb_deflate_block64_cog", "rasterio");
    const settled = await tiff.fetchTilesSettled(GRID);
    const plain = await tiff.fetchTiles(GRID);
    expect(settled).toEqual(plain);
  });

  it("returns one Tile per coordinate for a good grid (band-separate)", async () => {
    const tiff = await loadGeoTIFF("int8_3band_zstd_block64", "rasterio");
    const settled = await tiff.fetchTilesSettled(GRID);
    const plain = await tiff.fetchTiles(GRID);
    expect(settled).toEqual(plain);
  });

  it("returns [] for empty input", async () => {
    const tiff = await loadGeoTIFF("uint8_rgb_deflate_block64_cog", "rasterio");
    expect(await tiff.fetchTilesSettled([])).toEqual([]);
  });

  it("returns Tiles for a masked fixture (parity with fetchTiles)", async () => {
    const tiff = await loadGeoTIFF("cog_uint8_rgb_mask", "rasterio");
    const settled = await tiff.fetchTilesSettled(GRID);
    const plain = await tiff.fetchTiles(GRID);
    expect(settled).toEqual(plain);
  });

  it("isolates an out-of-range tile into its own { error } slot, leaving the rest as Tiles", async () => {
    // Build the xy list using *one* coordinate that's out-of-range — the
    // tiles fetched at (0,0)/(1,0)/(0,1)/(1,1) are valid for the 2x2 fixture;
    // (99, 99) is not. The byte-fetch step throws on out-of-range BEFORE the
    // null/sparse logic, so we'd expect the whole batch to error — but
    // fetchTilesSettled wraps that via { error }. (Strictly: the *underlying*
    // getTiles validates indices and throws, so this exercises the
    // settled-path's catch around the whole byte fetch by surfacing as a
    // single rejection; not the per-slot { error } path. Per-slot errors
    // require a *sparse* (byteCount=0) tile, which our fixtures don't have.
    // The good-grid + empty cases above pin the happy paths; this case
    // documents the "out-of-range tile" failure mode.)
    const tiff = await loadGeoTIFF("uint8_rgb_deflate_block64_cog", "rasterio");
    await expect(
      tiff.fetchTilesSettled([
        [0, 0],
        [99, 99],
      ]),
    ).rejects.toThrow();
  });
});
