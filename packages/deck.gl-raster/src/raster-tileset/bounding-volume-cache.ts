import type { OrientedBoundingBox } from "@math.gl/culling";

import type { Bounds, ZRange } from "./types.js";

/**
 * A memoized tile bounding volume, tagged with the elevation range it was
 * computed for (so a `zRange` change can invalidate it).
 */
export interface BoundingVolumeCacheEntry {
  zRange: ZRange;
  boundingVolume: OrientedBoundingBox;
  commonSpaceBounds: Bounds;
}

/**
 * Options for {@link BoundingVolumeCache}.
 */
export interface BoundingVolumeCacheOptions {
  /**
   * Soft cap on the number of cached tile bounding volumes. When a
   * `getTileIndices` traversal begins and the cache holds more than this many
   * entries, the least-recently-used entries are dropped down to roughly half.
   * Eviction never runs mid-traversal (only via {@link BoundingVolumeCache.sweep}),
   * so a single frame is never starved of an entry it computed earlier that
   * same frame. `0` makes every traversal start from an empty cache.
   *
   * @default 65_536
   */
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 65_536;

/**
 * An LRU cache of tile bounding volumes keyed by `"z/x/y"`.
 *
 * The raster tile traversal recomputes a tile's bounding volume (several proj4
 * reprojections plus an oriented-bounding-box fit) only on a cache miss; on a
 * hit it returns the stored volume. A tile's bounding volume depends only on
 * `(z, x, y, zRange)` for a given tileset descriptor, so it is safe to memoize
 * across `getTileIndices` calls (i.e. across animation frames).
 *
 * NOTE: this assumes a non-Globe traversal (`project === null`) — the only kind
 * `RasterTileNode.getBoundingVolume` currently supports. If Globe-view bounding
 * volumes are ever implemented, the cache key will need a viewport/resolution
 * component.
 */
export class BoundingVolumeCache {
  private entries = new Map<string, BoundingVolumeCacheEntry>();
  private maxEntries: number;

  constructor({
    maxEntries = DEFAULT_MAX_ENTRIES,
  }: BoundingVolumeCacheOptions = {}) {
    this.maxEntries = Math.max(0, maxEntries);
  }

  /** Number of cached entries. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Look up the cached bounding volume for tile `(z, x, y)`. On a hit the entry
   * is marked most-recently-used. Returns `undefined` on a miss.
   */
  get(z: number, x: number, y: number): BoundingVolumeCacheEntry | undefined {
    const key = `${z}/${x}/${y}`;
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    // Re-insert to move the key to the most-recently-used end of the Map.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  /** Store the bounding volume for tile `(z, x, y)` as most-recently-used. */
  set(z: number, x: number, y: number, entry: BoundingVolumeCacheEntry): void {
    const key = `${z}/${x}/${y}`;
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  /**
   * If the cache is over its soft cap, drop least-recently-used entries down to
   * roughly half of `maxEntries`. No-op when at or under the cap. Call once at
   * the start of a traversal, never mid-traversal.
   */
  sweep(): void {
    if (this.entries.size <= this.maxEntries) {
      return;
    }
    const target = Math.floor(this.maxEntries / 2);
    const excess = this.entries.size - target;
    const keysToDelete: string[] = [];
    for (const key of this.entries.keys()) {
      keysToDelete.push(key);
      if (keysToDelete.length >= excess) {
        break;
      }
    }
    for (const key of keysToDelete) {
      this.entries.delete(key);
    }
  }
}
