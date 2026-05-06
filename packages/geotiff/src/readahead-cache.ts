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
}

/**
 * A chunkd {@link SourceMiddleware} that caches sequential reads from offset 0
 * and grows underlying fetch sizes exponentially.
 *
 * Designed for TIFF metadata access, which is laid out near the start of the
 * file: an initial small fetch covers most files, and subsequent fetches grow
 * by `multiplier` to handle larger header structures with few round trips.
 *
 * Bypasses requests with negative offsets or undefined length (full-file
 * reads) — those go directly to the next layer.
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
  private readonly lock = mutex();

  constructor(options: SourceReadaheadCacheOptions) {
    this.initial = options.initial;
    this.multiplier = options.multiplier;
  }

  async fetch(req: SourceRequest, next: SourceCallback): Promise<ArrayBuffer> {
    if (req.offset < 0 || req.length == null) {
      return next(req);
    }
    const start = req.offset;
    const end = req.offset + req.length;
    const sourceSize = req.source.metadata?.size;

    return this.lock(async () => {
      while (!this.cache.contains(start, end)) {
        const cacheLen = this.cache.len;
        const needed = end - cacheLen;
        let fetchSize = Math.max(this.nextFetchSize(cacheLen), needed);
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
