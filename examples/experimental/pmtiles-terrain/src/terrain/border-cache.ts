import type { TileBorder } from "./halo.js";
import { extractBorder } from "./halo.js";
import type { TileIndex } from "./neighbors.js";
import { tileKey } from "./neighbors.js";

/**
 * Load one tile's elevations, row-major. Resolves `null` when the archive has
 * no such tile. Must stop work and reject when `signal` aborts.
 */
export type LoadElevation = (
  tile: TileIndex,
  signal: AbortSignal,
) => Promise<Float32Array | null>;

/** A load in flight, shared by every caller waiting on it. */
type Pending = {
  key: string;
  entry: Entry;
  elevation: Promise<Float32Array | null>;
  border: Promise<TileBorder | null>;
  controller: AbortController;
  /** Callers still holding the load. It aborts when this reaches zero. */
  refs: number;
};

/** What the cache knows about one tile. */
type Entry = {
  /** The tile's border once known, or `null` if the archive has no tile. */
  border?: TileBorder | null;
  /** The load in flight, if any. */
  pending?: Pending;
};

/** Options for {@link BorderCache}. */
export interface BorderCacheOptions {
  /** Fetches and decodes a tile. */
  load: LoadElevation;
  /** Width and height of a tile, in texels. */
  tileSize: number;
  /** How many settled tiles to keep. Loads in flight never count against it. */
  capacity: number;
}

/**
 * A cache of tile borders, shared by every tile the layer renders.
 *
 * A tile's halo needs its eight neighbors, which are mostly tiles the layer
 * renders too. So every load goes through here: a tile and its neighbors
 * share one load per tile, and a settled tile keeps only its border (its
 * outermost rows and columns: 8 KiB for a 512 px tile, not 1 MiB). The full
 * elevation goes only to the callers waiting when the load lands.
 *
 * Cancellation is counted, as `pmtiles` counts it for directory fetches: each
 * call holds the load it waits on, and when every caller's signal has aborted,
 * the load is aborted too. A call without a signal holds its load for good.
 */
export class BorderCache {
  /** Counts loads started: one per tile fetched and decoded. */
  readonly stats = { loads: 0 };

  readonly #load: LoadElevation;
  readonly #tileSize: number;
  readonly #capacity: number;
  /** Insertion order is recency: an entry moves to the end when used or settled. */
  readonly #entries = new Map<string, Entry>();

  constructor(options: BorderCacheOptions) {
    this.#load = options.load;
    this.#tileSize = options.tileSize;
    this.#capacity = options.capacity;
  }

  /** Number of tiles the cache knows about, settled or in flight. */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * The tile's border if it is known: the border, `null` if the archive has
   * no such tile, or `undefined` if it hasn't been loaded yet.
   */
  peekBorder(tile: TileIndex): TileBorder | null | undefined {
    return this.#entries.get(tileKey(tile))?.border;
  }

  /**
   * The tile's border. Answers from the cache when it is known, and otherwise
   * joins or starts the tile's load.
   *
   * @param signal - Ends this caller's wait, and the load once nobody waits.
   */
  getBorder(tile: TileIndex, signal?: AbortSignal): Promise<TileBorder | null> {
    const key = tileKey(tile);
    const entry = this.#entries.get(key);
    if (entry?.border !== undefined) {
      this.#touch(key, entry);
      return Promise.resolve(entry.border);
    }
    const pending = entry?.pending ?? this.#start(key, tile, entry);
    return this.#wait(pending, pending.border, signal);
  }

  /**
   * The tile's full elevation. Joins its load if one is in flight, and
   * otherwise starts one, even for a tile whose border is cached: only the
   * border is kept. The known border stays available meanwhile.
   *
   * @param signal - Ends this caller's wait, and the load once nobody waits.
   */
  getElevation(
    tile: TileIndex,
    signal?: AbortSignal,
  ): Promise<Float32Array | null> {
    const key = tileKey(tile);
    const entry = this.#entries.get(key);
    const pending = entry?.pending ?? this.#start(key, tile, entry);
    return this.#wait(pending, pending.elevation, signal);
  }

  /** Start loading a tile. Calls `load` synchronously. */
  #start(key: string, tile: TileIndex, existing?: Entry): Pending {
    const entry: Entry = existing ?? {};
    const controller = new AbortController();
    this.stats.loads += 1;
    const elevation = this.#load(tile, controller.signal);
    const pending: Pending = {
      key,
      entry,
      elevation,
      border: elevation.then((values) =>
        values === null ? null : extractBorder(values, this.#tileSize),
      ),
      controller,
      refs: 0,
    };
    entry.pending = pending;
    this.#entries.set(key, entry);

    pending.border.then(
      (border) => {
        if (entry.pending !== pending) {
          return;
        }
        entry.pending = undefined;
        entry.border = border;
        this.#touch(key, entry);
        this.#evict();
      },
      () => {
        // Failed or aborted: nothing to cache, so a later call loads again.
        if (entry.pending !== pending) {
          return;
        }
        entry.pending = undefined;
        if (entry.border === undefined) {
          this.#entries.delete(key);
        }
      },
    );
    return pending;
  }

  /** Hold `pending` for one caller until `result` settles or `signal` aborts. */
  #wait<T>(
    pending: Pending,
    result: Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    pending.refs += 1;
    if (!signal) {
      return result;
    }
    if (signal.aborted) {
      this.#release(pending);
      return Promise.reject(signal.reason);
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        this.#release(pending);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      result.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  /** Drop one caller's hold, and abort the load when it was the last. */
  #release(pending: Pending): void {
    pending.refs -= 1;
    if (pending.refs > 0) {
      return;
    }
    const { entry, key } = pending;
    if (entry.pending === pending) {
      entry.pending = undefined;
      if (entry.border === undefined) {
        this.#entries.delete(key);
      }
    }
    pending.controller.abort();
  }

  /** Mark an entry as the most recently used. */
  #touch(key: string, entry: Entry): void {
    this.#entries.delete(key);
    this.#entries.set(key, entry);
  }

  /** Drop the least recently used settled entries beyond capacity. */
  #evict(): void {
    let settled = 0;
    for (const entry of this.#entries.values()) {
      if (!entry.pending) {
        settled += 1;
      }
    }
    for (const [key, entry] of this.#entries) {
      if (settled <= this.#capacity) {
        return;
      }
      if (!entry.pending) {
        this.#entries.delete(key);
        settled -= 1;
      }
    }
  }
}
