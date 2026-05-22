import { describe, expect, it } from "vitest";
import type { BoundingVolumeCacheEntry } from "../../src/raster-tileset/bounding-volume-cache.js";
import { BoundingVolumeCache } from "../../src/raster-tileset/bounding-volume-cache.js";

function entry(tag: number): BoundingVolumeCacheEntry {
  return {
    zRange: [0, 0],
    boundingVolume: { tag } as any,
    commonSpaceBounds: [0, 0, 1, 1],
  };
}

// Globe and mercator volumes for the same (z, x, y) live in different common
// spaces; the cache key is only (z, x, y), so the owner clears the cache on a
// projection-mode switch rather than namespacing the key. This exercises the
// clear() primitive that switch relies on.
describe("BoundingVolumeCache.clear", () => {
  it("drops all entries", () => {
    const cache = new BoundingVolumeCache();
    cache.set(0, 0, 0, entry(1));
    cache.set(1, 0, 0, entry(2));
    expect(cache.size).toBe(2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get(0, 0, 0)).toBeUndefined();
    expect(cache.get(1, 0, 0)).toBeUndefined();
  });
});
