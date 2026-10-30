import type { TiffImage } from "@cogeotiff/core";
import { Compression, TiffTag } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { getMultipleBytes, getTiles } from "../src/fetch.js";
import type { CachedSubImageTags } from "../src/ifd.js";

/** Tags of an image without JPEG tables. */
const NO_JPEG_TABLES: CachedSubImageTags = { jpegTables: null };

/** Build a buffer where each byte equals `index % 256`. */
function makeBuffer(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    buf[i] = i & 0xff;
  }
  return buf;
}

/** Recording mock `dataSource` backed by an in-memory buffer. */
function recordingDataSource(buffer: Uint8Array) {
  const fetches: { offset: number; length: number }[] = [];
  return {
    fetches,
    fetch(offset: number, length: number): Promise<ArrayBuffer> {
      fetches.push({ offset, length });
      const slice = buffer.slice(offset, offset + length);
      return Promise.resolve(
        slice.buffer.slice(
          slice.byteOffset,
          slice.byteOffset + slice.byteLength,
        ) as ArrayBuffer,
      );
    },
  };
}

/**
 * Minimal `TiffImage` stand-in exposing only what `getMultipleBytes` / `getTiles`
 * touch: `size`, `tileSize`, `value(Compression)`, `getTileSize(idx)`.
 */
function mockImage(opts: {
  tileCount: { x: number; y: number };
  tileSize: { width: number; height: number };
  tiles: Map<number, { offset: number; imageSize: number }>;
  compression?: Compression;
}): TiffImage {
  return {
    size: {
      width: opts.tileCount.x * opts.tileSize.width,
      height: opts.tileCount.y * opts.tileSize.height,
    },
    tileSize: opts.tileSize,
    value: (tag: number) =>
      tag === TiffTag.Compression
        ? (opts.compression ?? Compression.None)
        : undefined,
    getTileSize: (idx: number) =>
      Promise.resolve(opts.tiles.get(idx) ?? { offset: 0, imageSize: 0 }),
  } as unknown as TiffImage;
}

describe("getMultipleBytes", () => {
  it("returns [] and makes no fetches for empty input", async () => {
    const ds = recordingDataSource(makeBuffer(64));
    const image = mockImage({
      tileCount: { x: 1, y: 1 },
      tileSize: { width: 16, height: 16 },
      tiles: new Map(),
    });
    expect(
      await getMultipleBytes(image, [], ds, { imageTags: NO_JPEG_TABLES }),
    ).toEqual([]);
    expect(ds.fetches.length).toBe(0);
  });

  it("returns bytes in input order, one read per range", async () => {
    const ds = recordingDataSource(makeBuffer(256));
    const image = mockImage({
      tileCount: { x: 2, y: 1 },
      tileSize: { width: 16, height: 16 },
      tiles: new Map(),
    });

    const result = await getMultipleBytes(
      image,
      [
        { offset: 120, byteCount: 10 },
        { offset: 100, byteCount: 10 },
      ],
      ds,
      { imageTags: NO_JPEG_TABLES },
    );

    // Merging is the range reader's job now: one read per range, in input
    // order, for the data source to merge or not.
    expect(ds.fetches).toEqual([
      { offset: 120, length: 10 },
      { offset: 100, length: 10 },
    ]);
    expect(result[0]!.compression).toBe(Compression.None);
    expect(new Uint8Array(result[0]!.bytes)).toEqual(
      makeBuffer(256).slice(120, 130),
    );
    expect(new Uint8Array(result[1]!.bytes)).toEqual(
      makeBuffer(256).slice(100, 110),
    );
  });

  it("yields null for sparse ranges (offset 0 or byteCount 0)", async () => {
    const ds = recordingDataSource(makeBuffer(64));
    const image = mockImage({
      tileCount: { x: 1, y: 1 },
      tileSize: { width: 16, height: 16 },
      tiles: new Map(),
    });

    const result = await getMultipleBytes(
      image,
      [
        { offset: 0, byteCount: 10 },
        { offset: 10, byteCount: 0 },
        { offset: 5, byteCount: 4 },
      ],
      ds,
      { imageTags: NO_JPEG_TABLES },
    );

    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(new Uint8Array(result[2]!.bytes)).toEqual(
      new Uint8Array([5, 6, 7, 8]),
    );
  });

  it("prepends the image's JPEG tables to JPEG-compressed tiles", async () => {
    const ds = recordingDataSource(makeBuffer(64));
    const image = mockImage({
      tileCount: { x: 1, y: 1 },
      tileSize: { width: 16, height: 16 },
      tiles: new Map(),
      compression: Compression.Jpeg,
    });
    // Start-of-image marker, the tables, end-of-image marker.
    const jpegTables = new Uint8Array([0xff, 0xd8, 0xaa, 0xff, 0xd9]);

    const [tile] = await getMultipleBytes(
      image,
      [{ offset: 5, byteCount: 4 }],
      ds,
      { imageTags: { jpegTables } },
    );

    expect(tile!.compression).toBe(Compression.Jpeg);
    // The tables without their end-of-image marker, then the tile's bytes
    // (5, 6, 7, 8) without the two where its start-of-image marker would be.
    expect(Array.from(new Uint8Array(tile!.bytes))).toEqual([
      0xff, 0xd8, 0xaa, 7, 8,
    ]);
  });
});

describe("getTiles", () => {
  it("returns [] for empty input", async () => {
    const ds = recordingDataSource(makeBuffer(64));
    const image = mockImage({
      tileCount: { x: 2, y: 2 },
      tileSize: { width: 16, height: 16 },
      tiles: new Map(),
    });
    expect(
      await getTiles(image, [], ds, { imageTags: NO_JPEG_TABLES }),
    ).toEqual([]);
  });

  it("resolves tile offsets and returns bytes in input order", async () => {
    const ds = recordingDataSource(makeBuffer(512));
    const image = mockImage({
      tileCount: { x: 2, y: 1 },
      tileSize: { width: 16, height: 16 },
      tiles: new Map([
        [0, { offset: 100, imageSize: 10 }],
        [1, { offset: 200, imageSize: 10 }],
      ]),
    });

    const result = await getTiles(
      image,
      [
        [1, 0],
        [0, 0],
      ],
      ds,
      { imageTags: NO_JPEG_TABLES },
    );

    expect(result.length).toBe(2);
    expect(new Uint8Array(result[0]!.bytes)).toEqual(
      makeBuffer(512).slice(200, 210),
    );
    expect(new Uint8Array(result[1]!.bytes)).toEqual(
      makeBuffer(512).slice(100, 110),
    );
  });

  it("returns null for sparse tiles", async () => {
    const ds = recordingDataSource(makeBuffer(64));
    const image = mockImage({
      tileCount: { x: 2, y: 1 },
      tileSize: { width: 16, height: 16 },
      tiles: new Map([
        [0, { offset: 0, imageSize: 0 }],
        [1, { offset: 0, imageSize: 0 }],
      ]),
    });

    const result = await getTiles(
      image,
      [
        [0, 0],
        [1, 0],
      ],
      ds,
      { imageTags: NO_JPEG_TABLES },
    );
    expect(result).toEqual([null, null]);
  });

  it("throws on out-of-range tile coordinates", async () => {
    const ds = recordingDataSource(makeBuffer(64));
    const image = mockImage({
      tileCount: { x: 2, y: 2 },
      tileSize: { width: 16, height: 16 },
      tiles: new Map(),
    });

    await expect(
      getTiles(image, [[2, 0]], ds, { imageTags: NO_JPEG_TABLES }),
    ).rejects.toThrow(/Tile index is outside of range/);
    await expect(
      getTiles(image, [[0, 2]], ds, { imageTags: NO_JPEG_TABLES }),
    ).rejects.toThrow(/Tile index is outside of range/);
  });

  it("throws when called on an untiled image", async () => {
    const ds = recordingDataSource(makeBuffer(64));
    const untiled = {
      size: { width: 32, height: 32 },
      tileSize: null,
    } as unknown as TiffImage;

    await expect(
      getTiles(untiled, [[0, 0]], ds, { imageTags: NO_JPEG_TABLES }),
    ).rejects.toThrow(/Tiff is not tiled/);
  });
});
