import type { TiffImage } from "@cogeotiff/core";
import { Compression, TiffTag } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { getMultipleBytes, getTiles } from "../src/fetch.js";

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
 * touch: `size`, `tileSize`, `value(Compression)`, `getTileSize(idx)`,
 * `getJpegHeader(bytes)`. `getJpegHeader` here prepends a `0xff` marker byte so
 * tests can detect that the JPEG path ran.
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
    getJpegHeader: (bytes: ArrayBuffer) => {
      const out = new Uint8Array(bytes.byteLength + 1);
      out[0] = 0xff;
      out.set(new Uint8Array(bytes), 1);
      return out.buffer;
    },
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
    expect(await getMultipleBytes(image, [], ds)).toEqual([]);
    expect(ds.fetches.length).toBe(0);
  });

  it("returns bytes in input order, coalescing nearby ranges", async () => {
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
    );

    // gap (120 - 110 = 10) is well under the 1 MiB default → one fetch.
    expect(ds.fetches.length).toBe(1);
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
    );

    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(new Uint8Array(result[2]!.bytes)).toEqual(
      new Uint8Array([5, 6, 7, 8]),
    );
  });

  it("prepends the JPEG header for JPEG-compressed tiles", async () => {
    const ds = recordingDataSource(makeBuffer(64));
    const image = mockImage({
      tileCount: { x: 1, y: 1 },
      tileSize: { width: 16, height: 16 },
      tiles: new Map(),
      compression: Compression.Jpeg,
    });

    const [tile] = await getMultipleBytes(
      image,
      [{ offset: 5, byteCount: 4 }],
      ds,
    );

    expect(tile!.compression).toBe(Compression.Jpeg);
    const out = new Uint8Array(tile!.bytes);
    expect(out.length).toBe(5);
    expect(out[0]).toBe(0xff);
    expect(Array.from(out.slice(1))).toEqual([5, 6, 7, 8]);
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
    expect(await getTiles(image, [], ds)).toEqual([]);
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

    await expect(getTiles(image, [[2, 0]], ds)).rejects.toThrow(
      /Tile index is outside of range/,
    );
    await expect(getTiles(image, [[0, 2]], ds)).rejects.toThrow(
      /Tile index is outside of range/,
    );
  });

  it("throws when called on an untiled image", async () => {
    const ds = recordingDataSource(makeBuffer(64));
    const untiled = {
      size: { width: 32, height: 32 },
      tileSize: null,
    } as unknown as TiffImage;

    await expect(getTiles(untiled, [[0, 0]], ds)).rejects.toThrow(
      /Tiff is not tiled/,
    );
  });
});
