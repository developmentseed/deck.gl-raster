import { SourceFile } from "@chunkd/source-file";
import { Tiff } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import { fixturePath } from "./helpers.js";

/**
 * Open a JPEG COG with a 256-byte first read, so cogeotiff leaves each image's
 * JpegTables tag lazy: its bytes aren't in what was read with the image's IFD.
 * Real COGs end up the same way when an image's tables sit past that first
 * read, as in some USGS historical topo overviews.
 */
async function openWithLazyJpegTables(): Promise<GeoTIFF> {
  const source = new SourceFile(fixturePath("cog_rgb_with_stats", "rio-tiler"));
  const tiff = await new Tiff(source, { defaultReadSize: 256 }).init();
  return GeoTIFF.fromTiff(tiff, source);
}

describe("JPEG tables", () => {
  it("reads the primary image's tiles when its tables weren't in the first read", async () => {
    const geotiff = await openWithLazyJpegTables();
    await expect(geotiff.fetchTile(0, 0)).resolves.toBeDefined();
  });

  it("reads an overview's tiles when its tables weren't in the first read", async () => {
    const geotiff = await openWithLazyJpegTables();
    const overview = geotiff.overviews[0]!;
    await expect(overview.fetchTile(0, 0)).resolves.toBeDefined();
  });
});
