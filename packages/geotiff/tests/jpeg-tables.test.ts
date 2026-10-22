import { readFile } from "node:fs/promises";
import { SourceMemory } from "@chunkd/source-memory";
import type { TagLazy, TiffImage } from "@cogeotiff/core";
import { Tiff, TiffTag } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { prependJpegTables } from "../src/fetch.js";
import { GeoTIFF } from "../src/geotiff.js";
import type { Tile } from "../src/tile.js";
import { fixturePath } from "./helpers.js";

/**
 * Open a JPEG COG whose overview has different JPEG tables from its primary
 * image, as some USGS historical topo maps do. The first read is 256 bytes, so
 * cogeotiff leaves each image's JpegTables tag lazy: its bytes aren't in what
 * was read with the image's IFD.
 */
async function openWithLazyJpegTables(): Promise<GeoTIFF> {
  const bytes = new Uint8Array(
    await readFile(fixturePath("cog_rgb_with_stats", "rio-tiler")),
  );
  const original = await new Tiff(new SourceMemory("original", bytes), {
    defaultReadSize: 256,
  }).init();
  // Both images in the fixture have the same tables. Change the overview's
  // first quantization value, after the start-of-image marker (2 bytes), the
  // DQT marker (2), the segment length (2), and the table id (1).
  const overview = original.images[1]!;
  const tag = overview.tags.get(TiffTag.JpegTables) as TagLazy<number[]>;
  const offset = tag.dataOffset + 7;
  bytes[offset] = bytes[offset]! + 1;

  const source = new SourceMemory("edited", bytes);
  const tiff = await new Tiff(source, { defaultReadSize: 256 }).init();
  return GeoTIFF.fromTiff(tiff, source);
}

/** The image's JpegTables tag, as cogeotiff reads it. */
async function jpegTablesOf(image: TiffImage): Promise<Uint8Array> {
  return new Uint8Array((await image.fetch(TiffTag.JpegTables))!);
}

/**
 * The JPEG stream a tile read built. JPEG decoding is the identity in tests
 * (see `polyfills.ts`), so a tile's pixels are the bytes it was decoded from.
 */
function decodedBytes(tile: Tile): Uint8Array {
  const { array } = tile;
  if (
    array.layout !== "pixel-interleaved" ||
    !(array.data instanceof Uint8Array)
  ) {
    throw new Error("Expected one Uint8Array of pixels");
  }
  return array.data;
}

/** The tables without their end-of-image marker, as they begin a tile's JPEG. */
function withoutEndOfImage(tables: Uint8Array): Uint8Array {
  return tables.subarray(0, tables.length - 2);
}

describe("prependJpegTables", () => {
  // Start-of-image marker, the tables, end-of-image marker.
  const tables = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  // Start-of-image marker, the tile's scan, end-of-image marker.
  const tile = new Uint8Array([0xff, 0xd8, 4, 5, 0xff, 0xd9]).buffer;

  it("joins the tables and a tile into one JPEG", () => {
    expect(new Uint8Array(prependJpegTables(tile, tables))).toEqual(
      new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]),
    );
  });

  it("returns the tile unchanged when the image has no tables", () => {
    expect(prependJpegTables(tile, null)).toBe(tile);
  });
});

describe("JPEG tables", () => {
  it("keeps the primary image's tables when they weren't in the first read", async () => {
    const geotiff = await openWithLazyJpegTables();
    expect(geotiff.cachedPrimaryImageTags.jpegTables).toEqual(
      await jpegTablesOf(geotiff.image),
    );
  });

  it("keeps an overview's own tables when they weren't in the first read", async () => {
    const geotiff = await openWithLazyJpegTables();
    const overview = geotiff.overviews[0]!;
    const tables = await jpegTablesOf(overview.image);
    expect(tables).not.toEqual(geotiff.cachedPrimaryImageTags.jpegTables);
    expect(overview.cachedSubImageTags.jpegTables).toEqual(tables);
  });

  it("reads the primary image's tiles with its tables", async () => {
    const geotiff = await openWithLazyJpegTables();
    const head = withoutEndOfImage(await jpegTablesOf(geotiff.image));
    const tile = await geotiff.fetchTile(0, 0);
    expect(decodedBytes(tile).subarray(0, head.length)).toEqual(head);
  });

  it("reads an overview's tiles with its own tables", async () => {
    const geotiff = await openWithLazyJpegTables();
    const overview = geotiff.overviews[0]!;
    const head = withoutEndOfImage(await jpegTablesOf(overview.image));
    const tile = await overview.fetchTile(0, 0);
    expect(decodedBytes(tile).subarray(0, head.length)).toEqual(head);
  });
});
