import { beforeEach, describe, expect, it } from "vitest";
import { fileIdentity } from "../src/identity.js";
import { MemoryByteCache } from "../src/memory-cache.js";

const file = fileIdentity("https://x.test/a.tif");
const bytes = (n: number, fill = 1): Uint8Array => new Uint8Array(n).fill(fill);

describe("MemoryByteCache", () => {
  let cache: MemoryByteCache;

  beforeEach(() => {
    cache = new MemoryByteCache();
  });

  it("serves a contained range as a view and misses on partial overlap", async () => {
    await cache.put(file, 100, bytes(50, 7), "data");
    const hit = await cache.get(file, { offset: 120, length: 10 }, "data");
    expect(hit).toEqual(bytes(10, 7));
    expect(
      await cache.get(file, { offset: 90, length: 20 }, "data"),
    ).toBeUndefined();
    expect(
      await cache.get(file, { offset: 149, length: 2 }, "data"),
    ).toBeUndefined();
  });

  it("serves a read of either purpose from a span the other purpose fetched", async () => {
    // The first tiles of a COG often sit inside its first header block; a
    // data read for them must not fetch them again.
    const cache = new MemoryByteCache({ dataBytes: 100, headerBytes: 100 });
    await cache.put(file, 0, bytes(60, 3), "header");
    expect(await cache.get(file, { offset: 10, length: 10 }, "data")).toEqual(
      bytes(10, 3),
    );
    expect(cache.byteSize("header")).toBe(60);
    expect(cache.byteSize("data")).toBe(0);
  });

  it("evicts least recently used spans within one purpose's budget", async () => {
    const cache = new MemoryByteCache({ dataBytes: 100, headerBytes: 100 });
    await cache.put(file, 0, bytes(60), "data");
    await cache.put(file, 1000, bytes(30), "data");
    await cache.get(file, { offset: 0, length: 1 }, "data");
    await cache.put(file, 2000, bytes(30), "data");
    expect(
      await cache.get(file, { offset: 1000, length: 1 }, "data"),
    ).toBeUndefined();
    expect(
      await cache.get(file, { offset: 0, length: 1 }, "data"),
    ).toBeDefined();
    expect(cache.byteSize("data")).toBe(90);
  });

  it("keeps header spans when data churns", async () => {
    const cache = new MemoryByteCache({ dataBytes: 100, headerBytes: 100 });
    await cache.put(file, 0, bytes(60), "header");
    for (let i = 0; i < 10; i++) {
      await cache.put(file, i * 1000, bytes(60), "data");
    }
    expect(
      await cache.get(file, { offset: 0, length: 60 }, "header"),
    ).toBeDefined();
    expect(cache.byteSize("header")).toBe(60);
    expect(cache.byteSize("data")).toBe(60);
  });

  it("does not store a span larger than the budget, or an empty one", async () => {
    const cache = new MemoryByteCache({ dataBytes: 100 });
    await cache.put(file, 0, bytes(150), "data");
    await cache.put(file, 500, bytes(0), "data");
    expect(cache.byteSize("data")).toBe(0);
    expect(
      await cache.get(file, { offset: 0, length: 1 }, "data"),
    ).toBeUndefined();
  });

  it("drops spans the new one contains and ignores a put the stored one contains", async () => {
    await cache.put(file, 10, bytes(20), "data");
    await cache.put(file, 0, bytes(100), "data");
    expect(cache.byteSize("data")).toBe(100);
    await cache.put(file, 30, bytes(5), "data");
    expect(cache.byteSize("data")).toBe(100);
  });

  it("keys spans by file identity", async () => {
    await cache.put(file, 0, bytes(10), "data");
    expect(
      await cache.get(
        fileIdentity("https://x.test/b.tif"),
        { offset: 0, length: 10 },
        "data",
      ),
    ).toBeUndefined();
  });
});
