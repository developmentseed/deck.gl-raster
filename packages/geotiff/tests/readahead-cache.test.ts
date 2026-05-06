import type { SourceCallback, SourceRequest } from "@chunkd/source";
import { describe, expect, it } from "vitest";
import {
  SequentialBlockCache,
  SourceReadaheadCache,
} from "../src/readahead-cache.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

function asString(buf: ArrayBuffer): string {
  return dec.decode(new Uint8Array(buf));
}

function buf(s: string): ArrayBuffer {
  return enc.encode(s).buffer as ArrayBuffer;
}

describe("SequentialBlockCache", () => {
  it("starts empty", () => {
    const cache = new SequentialBlockCache();
    expect(cache.len).toBe(0);
    expect(cache.contains(0, 0)).toBe(true);
    expect(cache.contains(0, 1)).toBe(false);
  });

  it("appendBuffer grows len", () => {
    const cache = new SequentialBlockCache();
    cache.appendBuffer(buf("abc"));
    expect(cache.len).toBe(3);
    cache.appendBuffer(buf("def"));
    expect(cache.len).toBe(6);
  });

  it("contains is true iff end <= len", () => {
    const cache = new SequentialBlockCache();
    cache.appendBuffer(buf("abcd"));
    expect(cache.contains(0, 4)).toBe(true);
    expect(cache.contains(2, 4)).toBe(true);
    expect(cache.contains(4, 4)).toBe(true);
    expect(cache.contains(0, 5)).toBe(false);
    expect(cache.contains(4, 5)).toBe(false);
  });

  it("slices a range that fits in one block", () => {
    const cache = new SequentialBlockCache();
    cache.appendBuffer(buf("abcdef"));
    expect(asString(cache.slice(0, 3))).toBe("abc");
    expect(asString(cache.slice(2, 5))).toBe("cde");
    expect(asString(cache.slice(0, 6))).toBe("abcdef");
  });

  it("slices across multiple blocks", () => {
    const cache = new SequentialBlockCache();
    cache.appendBuffer(buf("012"));
    cache.appendBuffer(buf("345"));
    cache.appendBuffer(buf("67"));

    expect(asString(cache.slice(0, 8))).toBe("01234567");
    expect(asString(cache.slice(2, 6))).toBe("2345");
    expect(asString(cache.slice(3, 8))).toBe("34567");
    expect(asString(cache.slice(5, 7))).toBe("56");
  });

  it("handles empty buffers (port of async-tiff test_sequential_block_cache_empty_buffers)", () => {
    const cache = new SequentialBlockCache();
    cache.appendBuffer(buf("012"));
    cache.appendBuffer(buf(""));
    cache.appendBuffer(buf("34"));
    cache.appendBuffer(buf(""));
    cache.appendBuffer(buf("5"));
    cache.appendBuffer(buf(""));
    cache.appendBuffer(buf("67"));

    expect(cache.contains(0, 3)).toBe(true);
    expect(asString(cache.slice(0, 3))).toBe("012");
    expect(cache.contains(4, 7)).toBe(true);
    expect(asString(cache.slice(4, 7))).toBe("456");
    expect(cache.contains(0, 8)).toBe(true);
    expect(asString(cache.slice(0, 8))).toBe("01234567");
    expect(cache.contains(6, 6)).toBe(true);
    expect(asString(cache.slice(6, 6))).toBe("");
    expect(cache.contains(6, 9)).toBe(false);
    expect(cache.contains(9, 9)).toBe(false);
    expect(cache.contains(8, 10)).toBe(false);
  });
});

/**
 * Build a fake `next` callback backed by a string. Counts the number of
 * underlying fetches and serves bytes from the string.
 */
function makeNext(data: string): {
  next: SourceCallback;
  count: () => number;
} {
  const bytes = enc.encode(data);
  let count = 0;
  const next: SourceCallback = async (req) => {
    count++;
    if (req.offset >= bytes.byteLength) {
      return new ArrayBuffer(0);
    }
    const end = Math.min(
      req.offset + (req.length ?? bytes.byteLength - req.offset),
      bytes.byteLength,
    );
    return bytes.buffer.slice(req.offset, end);
  };
  return { next, count: () => count };
}

function makeReq(offset: number, length: number): SourceRequest {
  // Source isn't inspected by SourceReadaheadCache except for `metadata?.size`,
  // which we leave undefined here.
  return {
    source: { metadata: undefined } as never,
    offset,
    length,
  };
}

describe("SourceReadaheadCache", () => {
  it("name is set", () => {
    const m = new SourceReadaheadCache({ initial: 32, multiplier: 2 });
    expect(m.name).toBe("source:readahead-cache");
  });

  it("ports the async-tiff readahead test", async () => {
    const { next, count } = makeNext("abcdefghijklmnopqrstuvwxyz");
    const m = new SourceReadaheadCache({ initial: 2, multiplier: 3 });

    // Initial request — fetches 2 bytes.
    let buf = await m.fetch(makeReq(0, 2), next);
    expect(asString(buf)).toBe("ab");
    expect(count()).toBe(1);

    // Within cached range — no new fetch.
    buf = await m.fetch(makeReq(1, 1), next);
    expect(asString(buf)).toBe("b");
    expect(count()).toBe(1);

    // Exceeds cached range — second fetch of 6 bytes (2 * 3) added.
    buf = await m.fetch(makeReq(2, 3), next);
    expect(asString(buf)).toBe("cde");
    expect(count()).toBe(2);

    // Cache len now 8 (2 + 6); request fully inside — no new fetch.
    buf = await m.fetch(makeReq(5, 3), next);
    expect(asString(buf)).toBe("fgh");
    expect(count()).toBe(2);

    // Request exceeds the next growth size — single fetch sized to the need.
    buf = await m.fetch(makeReq(8, 12), next);
    expect(asString(buf)).toBe("ijklmnopqrst");
    expect(count()).toBe(3);
  });

  it("bypasses negative offset reads", async () => {
    const { next, count } = makeNext("abcdefgh");
    const m = new SourceReadaheadCache({ initial: 4, multiplier: 2 });

    const req: SourceRequest = {
      source: { metadata: undefined } as never,
      offset: -4,
      length: 4,
    };
    await m.fetch(req, next);
    expect(count()).toBe(1);
  });

  it("bypasses reads with no length (full file)", async () => {
    const { next, count } = makeNext("abcdefgh");
    const m = new SourceReadaheadCache({ initial: 4, multiplier: 2 });

    const req: SourceRequest = {
      source: { metadata: undefined } as never,
      offset: 0,
      length: undefined,
    };
    await m.fetch(req, next);
    expect(count()).toBe(1);
  });

  it("serializes concurrent fetches that grow the cache", async () => {
    const { next, count } = makeNext("abcdefghijklmnop");
    const m = new SourceReadaheadCache({ initial: 4, multiplier: 2 });

    const [a, b, c] = await Promise.all([
      m.fetch(makeReq(0, 4), next),
      m.fetch(makeReq(4, 4), next),
      m.fetch(makeReq(8, 4), next),
    ]);

    expect(asString(a)).toBe("abcd");
    expect(asString(b)).toBe("efgh");
    expect(asString(c)).toBe("ijkl");

    // First fetch: 4 bytes (initial). Second: 8 bytes (4*2). Cache then has
    // 12 bytes, so the third concurrent request is satisfied without a third
    // underlying fetch.
    expect(count()).toBe(2);
  });

  it("clamps fetch size to file size when metadata.size is known", async () => {
    const bytes = enc.encode("abcdef");
    let count = 0;
    const next: SourceCallback = async (req) => {
      count++;
      // If our middleware sends an over-sized request, this would fail.
      expect(req.offset + (req.length ?? 0)).toBeLessThanOrEqual(
        bytes.byteLength,
      );
      const end = Math.min(req.offset + (req.length ?? 0), bytes.byteLength);
      return bytes.buffer.slice(req.offset, end);
    };

    const m = new SourceReadaheadCache({ initial: 100, multiplier: 2 });
    const req: SourceRequest = {
      source: { metadata: { size: 6 } } as never,
      offset: 0,
      length: 6,
    };

    const buf = await m.fetch(req, next);
    expect(asString(buf)).toBe("abcdef");
    expect(count).toBe(1);
  });

  it("breaks on EOF (zero-byte underlying fetch) instead of looping", async () => {
    // Source claims size unset, returns empty buffer past offset 4.
    const bytes = enc.encode("abcd");
    let count = 0;
    const next: SourceCallback = async (req) => {
      count++;
      if (req.offset >= bytes.byteLength) {
        return new ArrayBuffer(0);
      }
      const end = Math.min(req.offset + (req.length ?? 0), bytes.byteLength);
      return bytes.buffer.slice(req.offset, end);
    };

    const m = new SourceReadaheadCache({ initial: 2, multiplier: 2 });
    const req: SourceRequest = {
      source: { metadata: undefined } as never,
      offset: 0,
      length: 10, // more than the file has
    };

    // Should not hang; should return whatever's available without infinite loop.
    const buf = await m.fetch(req, next);
    // Cache stops growing at EOF; the slice copy is bounded by what's cached.
    expect(count).toBeLessThan(20);
    expect(buf.byteLength).toBeGreaterThanOrEqual(0);
  });
});
