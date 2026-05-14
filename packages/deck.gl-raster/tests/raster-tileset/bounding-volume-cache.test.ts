import { describe, expect, it } from "vitest";
import type { BoundingVolumeCacheEntry } from "../../src/raster-tileset/bounding-volume-cache.js";
import { BoundingVolumeCache } from "../../src/raster-tileset/bounding-volume-cache.js";

// The cache never inspects entry contents, so a tagged stub is enough.
function entry(tag: number): BoundingVolumeCacheEntry {
  return {
    zRange: [0, 0],
    boundingVolume: { tag } as any,
    commonSpaceBounds: [0, 0, 1, 1],
  };
}

function tagOf(e: BoundingVolumeCacheEntry | undefined): number | undefined {
  return e === undefined ? undefined : (e.boundingVolume as any).tag;
}

describe("BoundingVolumeCache", () => {
  it("returns undefined on a miss and the stored entry on a hit", () => {
    const cache = new BoundingVolumeCache();
    expect(cache.get(1, 2, 3)).toBeUndefined();
    const e = entry(42);
    cache.set(1, 2, 3, e);
    expect(cache.get(1, 2, 3)).toBe(e);
    expect(cache.size).toBe(1);
  });

  it("keys by (z, x, y) independently", () => {
    const cache = new BoundingVolumeCache();
    cache.set(0, 0, 0, entry(1));
    cache.set(1, 0, 0, entry(2));
    cache.set(0, 1, 0, entry(3));
    cache.set(0, 0, 1, entry(4));
    expect(cache.size).toBe(4);
    expect(tagOf(cache.get(0, 0, 0))).toBe(1);
    expect(tagOf(cache.get(1, 0, 0))).toBe(2);
    expect(tagOf(cache.get(0, 1, 0))).toBe(3);
    expect(tagOf(cache.get(0, 0, 1))).toBe(4);
  });

  it("sweep is a no-op when at or under the cap", () => {
    const cache = new BoundingVolumeCache({ maxEntries: 4 });
    for (let i = 0; i < 4; i++) {
      cache.set(0, i, 0, entry(i));
    }
    cache.sweep();
    expect(cache.size).toBe(4);
  });

  it("sweep drops least-recently-used entries down to ~half the cap", () => {
    const cache = new BoundingVolumeCache({ maxEntries: 4 });
    // Insert 0..5 (oldest -> newest): 6 entries > cap 4.
    for (let i = 0; i < 6; i++) {
      cache.set(0, i, 0, entry(i));
    }
    expect(cache.size).toBe(6);
    cache.sweep();
    // target = floor(4 / 2) = 2 -> the two most-recently-used survive.
    expect(cache.size).toBe(2);
    expect(cache.get(0, 4, 0)).toBeDefined();
    expect(cache.get(0, 5, 0)).toBeDefined();
    expect(cache.get(0, 0, 0)).toBeUndefined();
    expect(cache.get(0, 3, 0)).toBeUndefined();
  });

  it("get() refreshes recency so the entry survives the next sweep", () => {
    const cache = new BoundingVolumeCache({ maxEntries: 4 });
    for (let i = 0; i < 5; i++) {
      cache.set(0, i, 0, entry(i)); // 5 entries > cap 4
    }
    expect(cache.get(0, 0, 0)).toBeDefined(); // touch the oldest -> now MRU
    cache.sweep(); // target 2 -> the two MRU survive: (0,4,0) and (0,0,0)
    expect(cache.get(0, 0, 0)).toBeDefined();
    expect(cache.get(0, 4, 0)).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it("re-setting an existing key updates the value and refreshes recency", () => {
    const cache = new BoundingVolumeCache({ maxEntries: 4 });
    cache.set(0, 0, 0, entry(1));
    for (let i = 1; i < 5; i++) {
      cache.set(0, i, 0, entry(i)); // 5 entries total
    }
    cache.set(0, 0, 0, entry(99)); // re-set: value 99, now MRU; still 5 entries
    expect(cache.size).toBe(5);
    cache.sweep(); // target 2 -> MRU two survive: (0,4,0) then (0,0,0)
    expect(cache.size).toBe(2);
    expect(tagOf(cache.get(0, 0, 0))).toBe(99);
    expect(cache.get(0, 4, 0)).toBeDefined();
  });

  it("maxEntries 0 means sweep clears everything", () => {
    const cache = new BoundingVolumeCache({ maxEntries: 0 });
    cache.set(0, 0, 0, entry(1));
    cache.set(0, 1, 0, entry(2));
    expect(cache.size).toBe(2);
    cache.sweep();
    expect(cache.size).toBe(0);
  });
});
