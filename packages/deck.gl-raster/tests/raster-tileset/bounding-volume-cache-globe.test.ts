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

describe("BoundingVolumeCache: globe vs mercator keys", () => {
  it("does not let a globe entry collide with a mercator entry at the same z/x/y", () => {
    const cache = new BoundingVolumeCache();
    const mercator = entry(1);
    const globe = entry(2);

    cache.set(0, 0, 0, mercator); // default globe = false
    cache.set(0, 0, 0, globe, true);

    expect(cache.get(0, 0, 0)).toBe(mercator);
    expect(cache.get(0, 0, 0, true)).toBe(globe);
    expect(cache.size).toBe(2);
  });
});
