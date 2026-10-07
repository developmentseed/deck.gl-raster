import type {
  DecoderPool,
  GeoTIFF,
  Overview,
  Tile,
} from "@developmentseed/geotiff";

/** A resolution level of a COG — the full-resolution image or an overview. */
type Image = GeoTIFF | Overview;

/** Options for {@link TileCache.fetch}. */
export interface TileCacheFetchOptions {
  /** Decoder pool shared with the layer. */
  pool?: DecoderPool;
}

/**
 * A bounded LRU cache of decoded COG tiles, shared across every tile the
 * layer renders.
 *
 * Hillshade needs each tile's eight neighbors to build its halo, which would
 * naively cost nine decodes per rendered tile. But those neighbors are
 * themselves tiles the layer is about to render — they are in the viewport.
 * Caching decoded tiles means each one is fetched and decoded exactly once and
 * then consumed by up to nine halo assemblies, so the steady-state cost
 * approaches one decode per tile plus a one-tile ring around the viewport.
 *
 * Entries store the in-flight `Promise<Tile>` rather than the resolved value,
 * so concurrent halo assemblies asking for the same neighbor share one fetch
 * instead of racing.
 */
export class TileCache {
  /**
   * Insertion-ordered cache. A hit is deleted and re-inserted so that the
   * least recently used entry is always first.
   */
  #entries = new Map<string, Promise<Tile>>();

  /**
   * Tiles whose fetch has already settled, for {@link peek}. Kept alongside
   * {@link #entries} so a halo can be assembled from whatever has arrived
   * without awaiting anything.
   */
  #resolved = new Map<string, Tile>();

  /** Stable identity for each resolution level, used to build cache keys. */
  #imageIds = new WeakMap<object, number>();

  #nextImageId = 0;

  /** Maximum number of decoded tiles held at once. */
  readonly capacity: number;

  /**
   * @param options.capacity - Maximum number of decoded tiles to retain. Should
   *   comfortably exceed the tiles visible at one zoom so the viewport's
   *   neighbor ring stays resident.
   */
  constructor(options: { capacity: number }) {
    this.capacity = options.capacity;
  }

  /** Number of entries currently held. */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * Return tile `(x, y)` if its fetch has already settled, without awaiting.
   *
   * Used to assemble a halo from the neighbors that happen to be available
   * right now, so a tile can be displayed immediately rather than waiting on
   * its slowest neighbor.
   */
  peek(image: Image, x: number, y: number): Tile | null {
    return this.#resolved.get(`${this.#imageId(image)}/${x}/${y}`) ?? null;
  }

  /**
   * Fetch tile `(x, y)` of `image`, reusing an in-flight or completed fetch
   * when one exists.
   *
   * Note that no `AbortSignal` is threaded through: a cached tile may be
   * awaited by several halo assemblies, and aborting on behalf of one of them
   * would break the others. Tiles are small and self-limiting, so letting an
   * unneeded fetch complete is cheaper than the bookkeeping to share
   * cancellation correctly.
   *
   * @param image - The resolution level to read from.
   * @param x - Tile column index.
   * @param y - Tile row index.
   * @param options - Decoder pool to use.
   */
  fetch(
    image: Image,
    x: number,
    y: number,
    options: TileCacheFetchOptions = {},
  ): Promise<Tile> {
    const key = `${this.#imageId(image)}/${x}/${y}`;

    const cached = this.#entries.get(key);
    if (cached) {
      // Re-insert to mark as most recently used.
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return cached;
    }

    const promise = image.fetchTile(x, y, { pool: options.pool });

    promise.then(
      (tile) => {
        // Only record if this promise is still the cached one; it may have
        // been evicted while in flight.
        if (this.#entries.get(key) === promise) {
          this.#resolved.set(key, tile);
        }
      },
      () => {
        // A rejected fetch must not be cached, or it can never be retried.
        if (this.#entries.get(key) === promise) {
          this.#entries.delete(key);
        }
      },
    );

    this.#entries.set(key, promise);
    this.#evictToCapacity();
    return promise;
  }

  /** Drop every entry. */
  clear(): void {
    this.#entries.clear();
    this.#resolved.clear();
  }

  /** Assign (or look up) a stable numeric id for a resolution level. */
  #imageId(image: Image): number {
    let id = this.#imageIds.get(image);
    if (id === undefined) {
      id = this.#nextImageId++;
      this.#imageIds.set(image, id);
    }
    return id;
  }

  /** Evict least-recently-used entries until within {@link capacity}. */
  #evictToCapacity(): void {
    while (this.#entries.size > this.capacity) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) {
        return;
      }
      this.#entries.delete(oldest.value);
      this.#resolved.delete(oldest.value);
    }
  }
}
