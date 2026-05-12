/**
 * Tests for fetchTile and fetchTiles.
 *
 * Uses the unaligned fixture (265×266, 128×128 tiles) which has partial edge
 * tiles: right edge is 9px wide (265 % 128), bottom edge is 10px tall (266 % 128).
 */

import { SourceFile } from "@chunkd/source-file";
import type { Source } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import { fixturePath, loadGeoTIFF } from "./helpers.js";

/** A `dataSource` wrapper that records every `fetch` call (offset + length). */
class RecordingDataSource implements Pick<Source, "fetch"> {
  readonly calls: Array<{ offset: number; length: number | undefined }> = [];

  constructor(private readonly inner: Pick<Source, "fetch">) {}

  fetch(
    offset: number,
    length?: number,
    options?: { signal: AbortSignal },
  ): Promise<ArrayBuffer> {
    this.calls.push({ offset, length });
    return this.inner.fetch(offset, length, options);
  }
}

/**
 * Open a fixture with the tile-data reads routed through a {@link
 * RecordingDataSource}, so a test can count how many underlying `fetch`
 * calls the tile-data path made. Header/metadata reads use a separate plain
 * source and are not recorded.
 */
async function loadGeoTIFFRecordingData(
  name: string,
  variant: string,
): Promise<{ tiff: GeoTIFF; dataSource: RecordingDataSource }> {
  const path = fixturePath(name, variant);
  const dataSource = new RecordingDataSource(new SourceFile(path));
  const tiff = await GeoTIFF.open({
    dataSource,
    headerSource: new SourceFile(path),
  });
  return { tiff, dataSource };
}

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

describe("fetchTiles", () => {
  const GRID: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];

  it("coalesces a contiguous grid into fewer reads than per-tile fetches (pixel-interleaved)", async () => {
    const perTile = await loadGeoTIFFRecordingData(
      "uint8_rgb_deflate_block64_cog",
      "rasterio",
    );
    for (const [x, y] of GRID) {
      await perTile.tiff.fetchTile(x, y);
    }
    // One data read per tile when fetched individually.
    expect(perTile.dataSource.calls).toHaveLength(GRID.length);

    const batched = await loadGeoTIFFRecordingData(
      "uint8_rgb_deflate_block64_cog",
      "rasterio",
    );
    await batched.tiff.fetchTiles(GRID);
    expect(batched.dataSource.calls.length).toBeLessThan(GRID.length);
  });

  it("returns the same tiles as per-tile fetchTile (pixel-interleaved)", async () => {
    const tiff = await loadGeoTIFF("uint8_rgb_deflate_block64_cog", "rasterio");
    const batched = await tiff.fetchTiles(GRID);
    const individual = await Promise.all(
      GRID.map(([x, y]) => tiff.fetchTile(x, y)),
    );
    expect(batched).toEqual(individual);
  });

  it("returns the same tiles as per-tile fetchTile (band-separate)", async () => {
    const tiff = await loadGeoTIFF("int8_3band_zstd_block64", "rasterio");
    const batched = await tiff.fetchTiles(GRID);
    const individual = await Promise.all(
      GRID.map(([x, y]) => tiff.fetchTile(x, y)),
    );
    expect(batched).toEqual(individual);
  });

  it("attaches masks the same way fetchTile does", async () => {
    const tiff = await loadGeoTIFF("cog_uint8_rgb_mask", "rasterio");
    const batched = await tiff.fetchTiles(GRID);
    const individual = await Promise.all(
      GRID.map(([x, y]) => tiff.fetchTile(x, y)),
    );
    expect(batched).toEqual(individual);
    // sanity: this fixture really does carry a mask
    expect(batched[0]!.array.mask).not.toBeNull();
  });

  it("preserves input order for a shuffled request", async () => {
    const tiff = await loadGeoTIFF("uint8_rgb_deflate_block64_cog", "rasterio");
    const shuffled: Array<[number, number]> = [
      [1, 1],
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    const batched = await tiff.fetchTiles(shuffled);
    expect(batched.map((t) => [t.x, t.y])).toEqual(shuffled);
    const individual = await Promise.all(
      shuffled.map(([x, y]) => tiff.fetchTile(x, y)),
    );
    expect(batched).toEqual(individual);
  });

  it("propagates boundless: false (clips edge tiles)", async () => {
    const tiff = await loadGeoTIFF(
      "uint8_1band_deflate_block128_unaligned",
      "rasterio",
    );
    // 265×266 image, 128×128 tiles → 3×3; (2,2) is the partial corner tile.
    const corner: Array<[number, number]> = [
      [0, 0],
      [2, 2],
    ];
    const batched = await tiff.fetchTiles(corner, { boundless: false });
    const individual = await Promise.all(
      corner.map(([x, y]) => tiff.fetchTile(x, y, { boundless: false })),
    );
    expect(batched).toEqual(individual);
    // sanity: the corner tile really was clipped to the image bounds
    expect(batched[1]!.array.width).toBe(tiff.width % tiff.tileWidth);
    expect(batched[1]!.array.height).toBe(tiff.height % tiff.tileHeight);
  });

  it("coalesces band-separate tiles across bands and tiles", async () => {
    const perTile = await loadGeoTIFFRecordingData(
      "int8_3band_zstd_block64",
      "rasterio",
    );
    for (const [x, y] of GRID) {
      await perTile.tiff.fetchTile(x, y);
    }
    // 4 tiles × 3 bands = 12 independent reads via repeated fetchTile.
    expect(perTile.dataSource.calls).toHaveLength(GRID.length * 3);

    const batched = await loadGeoTIFFRecordingData(
      "int8_3band_zstd_block64",
      "rasterio",
    );
    await batched.tiff.fetchTiles(GRID);
    expect(batched.dataSource.calls.length).toBeLessThan(GRID.length * 3);
  });

  it("returns [] for an empty request without any reads", async () => {
    const { tiff, dataSource } = await loadGeoTIFFRecordingData(
      "uint8_rgb_deflate_block64_cog",
      "rasterio",
    );
    const result = await tiff.fetchTiles([]);
    expect(result).toEqual([]);
    expect(dataSource.calls).toHaveLength(0);
  });
});
