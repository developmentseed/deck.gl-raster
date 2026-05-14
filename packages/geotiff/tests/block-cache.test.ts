import { SourceCache, SourceChunk } from "@chunkd/middleware";
import type { Source } from "@chunkd/source";
import { SourceView } from "@chunkd/source";
import { SourceFile } from "@chunkd/source-file";
import { describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import { fixturePath } from "./helpers.js";

/** Wrap a Source to record every underlying fetch (offset + length). */
function instrument(source: Source): {
  source: Source;
  fetches: () => Array<{ offset: number; length: number | undefined }>;
} {
  const log: Array<{ offset: number; length: number | undefined }> = [];
  const wrapped: Source = {
    type: source.type,
    url: source.url,
    metadata: source.metadata,
    head: source.head.bind(source),
    fetch: async (offset, length, options) => {
      log.push({ offset, length });
      return source.fetch(offset, length, options);
    },
  };
  return { source: wrapped, fetches: () => log };
}

describe("block-aligned header cache", () => {
  const path = fixturePath("uint8_rgb_deflate_block64_cog", "rasterio");

  it("opens a fixture through SourceChunk + SourceCache", async () => {
    const file = new SourceFile(path);
    const { source, fetches } = instrument(file);
    const view = new SourceView(source, [
      new SourceChunk({ size: 64 * 1024 }),
      new SourceCache({ size: 8 * 1024 * 1024 }),
    ]);

    const tiff = await GeoTIFF.open({
      dataSource: file,
      headerSource: view,
    });

    expect(tiff.width).toBeGreaterThan(0);
    expect(tiff.height).toBeGreaterThan(0);
    expect(fetches().length).toBeGreaterThan(0);

    // Every underlying fetch must be aligned to 64 KiB boundaries because
    // SourceChunk pads requests up to chunkSize.
    for (const { offset, length } of fetches()) {
      expect(offset % (64 * 1024)).toBe(0);
      if (length !== undefined) {
        expect(length).toBeLessThanOrEqual(64 * 1024);
      }
    }
  });

  it("does not pull image-data bytes through the header cache after open", async () => {
    // Tiff.create() in GeoTIFF.open disables `tiff.options`, so getTileSize
    // takes the explicit TileOffsets/TileByteCounts path — not the
    // leader-bytes path that would fetch 4 bytes adjacent to image data.
    const file = new SourceFile(path);
    const { source, fetches } = instrument(file);
    const view = new SourceView(source, [
      new SourceChunk({ size: 64 * 1024 }),
      new SourceCache({ size: 8 * 1024 * 1024 }),
    ]);

    const tiff = await GeoTIFF.open({
      dataSource: file,
      headerSource: view,
    });

    expect(tiff.tiff.options).toBeUndefined();

    const fetchesAfterOpen = fetches().length;

    // Trigger a tile metadata lookup through cogeotiff's lazy path.
    await tiff.image.getTileSize(0);

    // At most 2 new underlying chunk fetches (TileOffsets + TileByteCounts
    // blocks); often 0 if the relevant chunks are already cached from open.
    const newFetches = fetches().slice(fetchesAfterOpen);
    expect(newFetches.length).toBeLessThanOrEqual(2);
  });
});
