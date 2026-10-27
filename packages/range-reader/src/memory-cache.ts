import type { ByteCache, ByteRange, FileIdentity, Purpose } from "./types.js";

/** Default budget for header-purpose spans, shared by every file a reader serves. */
export const DEFAULT_HEADER_CACHE_BYTES = 32 * 1024 * 1024;

/** Default budget for data-purpose spans, shared by every file a reader serves. */
export const DEFAULT_DATA_CACHE_BYTES = 64 * 1024 * 1024;

/** One stored span: contiguous bytes of one file, starting at `offset`. */
interface Span {
  readonly id: number;
  readonly fileKey: string;
  readonly purpose: Purpose;
  readonly offset: number;
  readonly bytes: Uint8Array;
}

/** The spans of one purpose and the budget they share, in LRU order. */
class Tier {
  size = 0;
  /** Insertion order is recency: the first entry is the least recently used. */
  readonly order = new Map<number, Span>();

  constructor(readonly budget: number) {}
}

/**
 * The default {@link ByteCache}: contiguous spans in memory, looked up by
 * containment, with one LRU budget per {@link Purpose} so data churn can
 * never evict header spans. A span larger than its budget, or empty, is not
 * stored. A span contained in a stored span is dropped; stored spans the new
 * span contains are replaced by it. Partial overlaps are kept side by side
 * and are misses for a read that straddles them.
 */
export class MemoryByteCache implements ByteCache {
  private readonly tiers: Record<Purpose, Tier>;
  private readonly byFile = new Map<string, Set<Span>>();
  private nextId = 0;

  constructor(options: { headerBytes?: number; dataBytes?: number } = {}) {
    this.tiers = {
      header: new Tier(options.headerBytes ?? DEFAULT_HEADER_CACHE_BYTES),
      data: new Tier(options.dataBytes ?? DEFAULT_DATA_CACHE_BYTES),
    };
  }

  get(
    file: FileIdentity,
    range: ByteRange,
    purpose: Purpose,
  ): Promise<Uint8Array | undefined> {
    const end = range.offset + range.length;
    for (const span of this.byFile.get(file.key) ?? []) {
      if (
        span.purpose === purpose &&
        span.offset <= range.offset &&
        span.offset + span.bytes.length >= end
      ) {
        const tier = this.tiers[purpose];
        tier.order.delete(span.id);
        tier.order.set(span.id, span);
        const start = range.offset - span.offset;
        return Promise.resolve(
          span.bytes.subarray(start, start + range.length),
        );
      }
    }
    return Promise.resolve(undefined);
  }

  put(
    file: FileIdentity,
    offset: number,
    bytes: Uint8Array,
    purpose: Purpose,
  ): Promise<void> {
    const tier = this.tiers[purpose];
    if (bytes.length === 0 || bytes.length > tier.budget) {
      return Promise.resolve();
    }
    const end = offset + bytes.length;
    const contained: Span[] = [];
    for (const span of this.byFile.get(file.key) ?? []) {
      if (span.purpose !== purpose) {
        continue;
      }
      const spanEnd = span.offset + span.bytes.length;
      if (span.offset <= offset && spanEnd >= end) {
        return Promise.resolve();
      }
      if (offset <= span.offset && end >= spanEnd) {
        contained.push(span);
      }
    }
    for (const span of contained) {
      this.remove(span);
    }
    // Looked up after the removals: `remove` drops a file's entry once it
    // holds no spans, so an earlier reference could be an orphaned set.
    let spans = this.byFile.get(file.key);
    if (spans === undefined) {
      spans = new Set();
      this.byFile.set(file.key, spans);
    }
    const span: Span = {
      id: this.nextId++,
      fileKey: file.key,
      purpose,
      offset,
      bytes,
    };
    spans.add(span);
    tier.order.set(span.id, span);
    tier.size += bytes.length;
    for (const oldest of tier.order.values()) {
      if (tier.size <= tier.budget) {
        break;
      }
      this.remove(oldest);
    }
    return Promise.resolve();
  }

  byteSize(purpose: Purpose): number {
    return this.tiers[purpose].size;
  }

  private remove(span: Span): void {
    const tier = this.tiers[span.purpose];
    if (tier.order.delete(span.id)) {
      tier.size -= span.bytes.length;
    }
    const spans = this.byFile.get(span.fileKey);
    spans?.delete(span);
    if (spans?.size === 0) {
      this.byFile.delete(span.fileKey);
    }
  }
}
