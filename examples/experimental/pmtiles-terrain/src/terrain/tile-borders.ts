import type { TileBorder } from "./halo.js";
import type { TileIndex } from "./neighbors.js";
import { CENTER_INDEX, neighborIndices, tileKey } from "./neighbors.js";

/** Options for {@link TileBorders}. */
export interface TileBordersOptions {
  /** How many borders to remember, at 8 KiB each for a 512 px tile. */
  capacity: number;
}

/**
 * The borders of tiles that have loaded, and the loaded tiles that want to
 * hear when a neighbor's border arrives.
 *
 * A tile's halo is filled only from neighbors that load anyway, because
 * they're in view: nothing is fetched just for a halo. When a tile loads, it
 * reads its neighbors' borders from here and adds its own, and the neighbors
 * already loaded rewrite their side of the halo. A side with no loaded
 * neighbor replicates the tile's own edge until one arrives; such sides are
 * off screen, at the edge of what's loaded.
 *
 * Borders outlive their tiles, up to `capacity`, so a tile that loads later
 * still finds its neighbor's border after deck.gl has evicted the neighbor.
 */
export class TileBorders {
  readonly #capacity: number;
  /** Insertion order is recency: a border moves to the end when read or added. */
  readonly #borders = new Map<string, TileBorder>();
  /** Loaded tiles' callbacks, by tile key. A reloaded tile may briefly have two. */
  readonly #watchers = new Map<string, Set<() => void>>();

  constructor(options: TileBordersOptions) {
    this.#capacity = options.capacity;
  }

  /** The border of a tile that has loaded, if it's still remembered. */
  get(tile: TileIndex): TileBorder | undefined {
    const key = tileKey(tile);
    const border = this.#borders.get(key);
    if (border) {
      this.#borders.delete(key);
      this.#borders.set(key, border);
    }
    return border;
  }

  /**
   * Remember a loaded tile's border, and tell each loaded neighbor once.
   *
   * @returns How many neighbor callbacks ran, so the caller knows whether to
   *   ask for a redraw.
   */
  add(tile: TileIndex, border: TileBorder): number {
    const key = tileKey(tile);
    this.#borders.delete(key);
    this.#borders.set(key, border);
    while (this.#borders.size > this.#capacity) {
      const oldest = this.#borders.keys().next();
      if (oldest.done) {
        break;
      }
      this.#borders.delete(oldest.value);
    }

    // A neighbor can border the tile on two sides (z0, z1), so dedupe.
    const neighborKeys = new Set<string>();
    for (const [i, neighbor] of neighborIndices(tile).entries()) {
      if (neighbor && i !== CENTER_INDEX) {
        neighborKeys.add(tileKey(neighbor));
      }
    }
    neighborKeys.delete(key);
    let told = 0;
    for (const neighborKey of neighborKeys) {
      for (const onNeighbor of this.#watchers.get(neighborKey) ?? []) {
        onNeighbor();
        told += 1;
      }
    }
    return told;
  }

  /**
   * Ask to be told whenever one of `tile`'s neighbors adds its border.
   *
   * @returns A function that stops it. Call it when the tile is unloaded.
   */
  watch(tile: TileIndex, onNeighbor: () => void): () => void {
    const key = tileKey(tile);
    let watchers = this.#watchers.get(key);
    if (!watchers) {
      watchers = new Set();
      this.#watchers.set(key, watchers);
    }
    watchers.add(onNeighbor);
    return () => {
      watchers.delete(onNeighbor);
      if (watchers.size === 0 && this.#watchers.get(key) === watchers) {
        this.#watchers.delete(key);
      }
    };
  }
}
