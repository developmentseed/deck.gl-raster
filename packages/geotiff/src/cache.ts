import type {
  SourceCallback,
  SourceMiddleware,
  SourceRequest,
} from "@chunkd/source";

/** One cached read. */
interface CacheEntry {
  /** The read, shared by every caller of its byte range. */
  promise: Promise<ArrayBuffer>;
  /** Length of the byte range, counted against the cache size. */
  size: number;
}

/**
 * chunkd middleware that caches each read by its byte range, so concurrent
 * and later reads of a range share one request.
 *
 * Adapted from `SourceCache` in `@chunkd/middleware` 11.3.1, which keeps a
 * read that fails and replays the failure to every later reader of that
 * range (https://github.com/blacha/chunkd/issues/1733). Here a failed read is
 * evicted, so the next reader retries it.
 *
 * Eviction is generational, as upstream: entries accumulate in `current`
 * until it holds more than `maxSize` bytes, then `current` becomes `previous`
 * and the old `previous` is dropped. A hit in `previous` moves the entry back
 * to `current`.
 *
 * @internal
 */
export class CacheMiddleware implements SourceMiddleware {
  readonly name = "cache";
  private readonly maxSize: number;
  /** Bytes held by `current`. */
  private size = 0;
  private current = new Map<string, CacheEntry>();
  private previous = new Map<string, CacheEntry>();

  /**
   * @param options.size Bytes the cache holds before it starts dropping its
   *   oldest reads.
   */
  constructor(options: { size: number }) {
    this.maxSize = options.size;
  }

  fetch(req: SourceRequest, next: SourceCallback): Promise<ArrayBuffer> {
    // A read to the end of the file has no fixed size to account for.
    if (req.length == null) {
      return next(req);
    }
    const key = `${req.source.url.href}@${req.offset}+${req.length}`;

    const hit = this.current.get(key);
    if (hit) {
      return hit.promise;
    }
    const previousHit = this.previous.get(key);
    if (previousHit) {
      this.previous.delete(key);
      this.current.set(key, previousHit);
      this.size += previousHit.size;
      return previousHit.promise;
    }

    const entry: CacheEntry = { promise: next(req), size: req.length };
    entry.promise.catch(() => this.evict(key, entry));
    this.size += entry.size;
    if (this.size > this.maxSize) {
      this.previous = this.current;
      this.current = new Map();
      this.size = entry.size;
    }
    this.current.set(key, entry);
    return entry.promise;
  }

  /**
   * Remove `entry` from the cache. Checks identity rather than the key alone:
   * the cache may have dropped `entry` while its read was in flight and since
   * stored a newer read of the same range, which must stay.
   */
  private evict(key: string, entry: CacheEntry): void {
    if (this.current.get(key) === entry) {
      this.current.delete(key);
      this.size -= entry.size;
    }
    if (this.previous.get(key) === entry) {
      this.previous.delete(key);
    }
  }
}
