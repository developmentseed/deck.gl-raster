import type {
  SourceCallback,
  SourceMiddleware,
  SourceRequest,
} from "@chunkd/source";
import { mutex } from "./concurrency.js";

/**
 * Contiguous-from-zero buffer cache.
 *
 * Stores a sequence of buffers logically concatenated from byte offset 0.
 * Used by {@link SourceReadaheadCache} to retain previously fetched ranges.
 *
 * @internal
 */
export class SequentialBlockCache {
  private readonly buffers: Uint8Array[] = [];

  /** Total cached length in bytes (sum of buffer lengths). */
  len = 0;

  /** Append a buffer to the end of the cache. */
  appendBuffer(buffer: ArrayBuffer): void {
    const view = new Uint8Array(buffer);
    this.len += view.byteLength;
    this.buffers.push(view);
  }

  /** True iff the byte range `[start, end)` is fully cached. */
  contains(_start: number, end: number): boolean {
    return end <= this.len;
  }

  /**
   * Slice the byte range `[start, end)` out of the cached buffers.
   *
   * Returns a zero-copy slice when the range fits in one block; copies
   * into a fresh buffer when it spans multiple blocks. Caller must ensure
   * the range is fully cached (see {@link contains}).
   */
  slice(start: number, end: number): ArrayBuffer {
    const outLen = end - start;
    if (outLen === 0) {
      return new ArrayBuffer(0);
    }

    let remainingStart = start;
    let remainingEnd = end;
    const parts: Uint8Array[] = [];

    for (const block of this.buffers) {
      const blockLen = block.byteLength;
      if (remainingStart >= blockLen) {
        remainingStart -= blockLen;
        remainingEnd -= blockLen;
        continue;
      }
      const sliceStart = remainingStart;
      const sliceEnd = Math.min(remainingEnd, blockLen);
      if (sliceEnd > sliceStart) {
        parts.push(block.subarray(sliceStart, sliceEnd));
      }
      remainingStart = 0;
      if (remainingEnd <= blockLen) {
        break;
      }
      remainingEnd -= blockLen;
    }

    if (parts.length === 1) {
      const part = parts[0]!;
      const out = new Uint8Array(part.byteLength);
      out.set(part);
      return out.buffer;
    }

    const out = new Uint8Array(outLen);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out.buffer;
  }
}

/**
 * Options for {@link SourceReadaheadCache}.
 */
export interface SourceReadaheadCacheOptions {
  /** Bytes fetched on the first underlying read. */
  initial: number;
  /** Multiplier applied to the previous fetch size on each subsequent read. */
  multiplier: number;
  /**
   * Maximum bytes a single underlying fetch may add to the cache. If
   * satisfying a request would require extending the cache by more than this,
   * the middleware bypasses the cache entirely for that request and serves it
   * with one direct fetch instead. Bounds the worst case when cogeotiff reads
   * at a far offset during the open phase (e.g. GDAL ghost-header probes at
   * EOF). Defaults to {@link DEFAULT_MAX_EXTENSION}.
   */
  maxExtension?: number;
}

/** Default cap on per-fetch cache extension: 4 MiB. */
export const DEFAULT_MAX_EXTENSION = 4 * 1024 * 1024;

/**
 * A chunkd {@link SourceMiddleware} that caches sequential reads from offset 0
 * and grows underlying fetch sizes exponentially.
 *
 * Designed for TIFF metadata access, which is laid out near the start of the
 * file: an initial small fetch covers most files, and subsequent fetches grow
 * by `multiplier` to handle larger header structures with few round trips.
 *
 * # Lifecycle
 *
 * The cache has two states:
 *
 * - **Active** (the default): on a miss, the cache extends by exponentially
 *   growing reads. On a hit (range fully covered by `[0, cache.len)`), it
 *   serves directly from the in-memory buffer.
 * - **Frozen** (after {@link freeze} is called): cache hits are still served,
 *   but misses bypass to `next()` directly — the cache never extends again.
 *
 * `GeoTIFF.fromUrl` calls {@link freeze} once the open phase (`Tiff.create` +
 * `prefetchTags(primaryImage)`) finishes. From that point on, the cache acts
 * as a read-only in-memory index of the bytes already pulled during open.
 *
 * # Bounded extension
 *
 * Even while active, a single underlying fetch is capped at
 * {@link SourceReadaheadCacheOptions.maxExtension} bytes. If satisfying a
 * request would require pulling more than the cap in one extension — e.g.
 * the request is at a far offset, or it is just very large — the middleware
 * bypasses for that request and returns `next(req)` directly. The cache
 * stays at its current size; the rare far-offset read pays one round trip
 * but does not pollute the cache.
 *
 * # Bypass cases
 *
 * Requests with negative offsets, or with `length == null` (full-file
 * reads), always bypass to the next layer regardless of state.
 *
 * Stateful per instance: pairs one-to-one with a single source's lifetime.
 *
 * @internal
 */
export class SourceReadaheadCache implements SourceMiddleware {
  readonly name = "source:readahead-cache";

  private readonly cache = new SequentialBlockCache();
  private readonly initial: number;
  private readonly multiplier: number;
  private readonly maxExtension: number;
  private readonly lock = mutex();
  private frozen = false;

  constructor(options: SourceReadaheadCacheOptions) {
    this.initial = options.initial;
    this.multiplier = options.multiplier;
    this.maxExtension = options.maxExtension ?? DEFAULT_MAX_EXTENSION;
  }

  /**
   * Stop extending the cache. Hits continue to be served from memory; misses
   * bypass to the next layer.
   *
   * Intended to be called once `GeoTIFF.fromUrl` has finished its open-phase
   * reads. At that point cogeotiff's subsequent reads are at arbitrary
   * offsets (lazy IFD lookups, GDAL ghost-header probes, per-tile lookups)
   * and do not benefit from sequential-from-zero growth — and in fact would
   * cause catastrophic over-fetching as the cache grows exponentially to
   * encompass each new far-offset request.
   *
   * Idempotent. One-way: there is no `unfreeze()`.
   */
  freeze(): void {
    this.frozen = true;
  }

  async fetch(req: SourceRequest, next: SourceCallback): Promise<ArrayBuffer> {
    if (req.offset < 0 || req.length == null) {
      return next(req);
    }
    const start = req.offset;
    const end = req.offset + req.length;
    const sourceSize = req.source.metadata?.size;

    return this.lock(async () => {
      // Cache hits are always served from memory, regardless of frozen state.
      if (this.cache.contains(start, end)) {
        return this.cache.slice(start, end);
      }

      // On miss after freeze: never extend; serve with a direct fetch.
      if (this.frozen) {
        return next(req);
      }

      // While active: if extending would exceed the per-fetch cap, bypass
      // for this request instead of pulling a large chunk into the cache.
      // This guards against pathological reads during the open phase (e.g.
      // a tag value or ghost header at the end of the file).
      const needed = end - this.cache.len;
      const naiveFetchSize = Math.max(
        this.nextFetchSize(this.cache.len),
        needed,
      );
      if (naiveFetchSize > this.maxExtension) {
        return next(req);
      }

      while (!this.cache.contains(start, end)) {
        const cacheLen = this.cache.len;
        const stepNeeded = end - cacheLen;
        let fetchSize = Math.max(this.nextFetchSize(cacheLen), stepNeeded);
        if (sourceSize != null) {
          const remaining = sourceSize - cacheLen;
          if (remaining <= 0) {
            break;
          }
          fetchSize = Math.min(fetchSize, remaining);
        }
        const buf = await next({
          ...req,
          offset: cacheLen,
          length: fetchSize,
        });
        if (buf.byteLength === 0) {
          break;
        }
        this.cache.appendBuffer(buf);
      }
      const sliceEnd = Math.min(end, this.cache.len);
      return this.cache.slice(start, sliceEnd);
    });
  }

  private nextFetchSize(existingLen: number): number {
    if (existingLen === 0) {
      return this.initial;
    }
    return Math.round(existingLen * this.multiplier);
  }
}
