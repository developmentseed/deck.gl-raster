import type { Source } from "@chunkd/source";
import { SourceView } from "@chunkd/source";
import { SourceFile } from "@chunkd/source-file";
import { describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import { SourceReadaheadCache } from "../src/readahead-cache.js";
import { fixturePath } from "./helpers.js";

/**
 * Wrap a Source so we can count fetches that hit the underlying file.
 */
function counting(source: Source): { source: Source; count: () => number } {
  let count = 0;
  const wrapped: Source = {
    type: source.type,
    url: source.url,
    metadata: source.metadata,
    head: source.head.bind(source),
    fetch: async (offset, length, options) => {
      count++;
      return source.fetch(offset, length, options);
    },
  };
  return { source: wrapped, count: () => count };
}

describe("SourceReadaheadCache integration", () => {
  const path = fixturePath("uint8_rgb_deflate_block64_cog", "rasterio");

  it("opens a fixture through the new middleware", async () => {
    const file = new SourceFile(path);
    const { source, count } = counting(file);
    const view = new SourceView(source, [
      new SourceReadaheadCache({ initial: 32 * 1024, multiplier: 2 }),
    ]);

    const tiff = await GeoTIFF.open({
      dataSource: file,
      headerSource: view,
      prefetch: 32 * 1024,
    });

    expect(tiff.width).toBeGreaterThan(0);
    expect(tiff.height).toBeGreaterThan(0);
    expect(count()).toBeGreaterThan(0);
  });

  it("opens with a tiny initial size and grows the cache as needed", async () => {
    // Force multiple cache extensions by starting with a tiny initial size.
    const file = new SourceFile(path);
    const { source, count } = counting(file);
    const view = new SourceView(source, [
      new SourceReadaheadCache({ initial: 256, multiplier: 2 }),
    ]);

    const tiff = await GeoTIFF.open({
      dataSource: file,
      headerSource: view,
      prefetch: 256,
    });

    expect(tiff.width).toBeGreaterThan(0);
    // With a 256-byte initial size, we expect more than one underlying fetch
    // to read the IFD chain — proving the cache extends correctly.
    expect(count()).toBeGreaterThan(1);
  });

  it("disables the readahead cache after open completes (full fromUrl path)", async () => {
    const file = new SourceFile(path);
    const counter = counting(file);

    const readahead = new SourceReadaheadCache({
      initial: 32 * 1024,
      multiplier: 2,
    });
    const view = new SourceView(counter.source, [readahead]);

    // Mirror what GeoTIFF.fromUrl does internally:
    await GeoTIFF.open({
      dataSource: file,
      headerSource: view,
      prefetch: 32 * 1024,
    });
    readahead.disable();

    const fetchesBeforePostOpenReads = counter.count();

    // Issue some far-offset reads through the wrapped view — exactly what
    // cogeotiff would do when lazy-loading an unfetched overview's tag.
    // Each post-disable read must hit raw underlying source 1:1; the cache
    // must not extend.
    const head = await view.head();
    const fileSize = head.size!;

    await view.fetch(Math.floor(fileSize * 0.5), 8);
    await view.fetch(Math.floor(fileSize * 0.7), 8);
    await view.fetch(Math.floor(fileSize * 0.9), 8);

    const fetchesAfterPostOpenReads = counter.count();
    const postOpenFetchCount =
      fetchesAfterPostOpenReads - fetchesBeforePostOpenReads;

    // Three direct reads → exactly three underlying fetches. No growth.
    expect(postOpenFetchCount).toBe(3);
  });
});
