import { describe, expect, it } from "vitest";
import { SequentialBlockCache } from "../src/readahead-cache.js";

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
