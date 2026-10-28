import type { ConcurrencyLimiter } from "./limiter.js";
import { MemoryByteCache } from "./memory-cache.js";
import { mergeReads, widenRead } from "./merge.js";
import type {
  RangeStreamOptions,
  StreamMember,
  StreamOutcome,
} from "./stream.js";
import { RangeStream } from "./stream.js";
import type {
  ByteCache,
  ByteRange,
  FileIdentity,
  FileKey,
  Purpose,
  RangeReaderOptions,
  RangeReaderStats,
  ReadOptions,
  ReadRange,
  ReadResult,
} from "./types.js";

/** Default for {@link RangeReaderOptions.maxOverfetchBytes}: 1 MiB. */
export const DEFAULT_MAX_OVERFETCH_BYTES = 1024 * 1024;

/** Default for {@link RangeReaderOptions.maxRequestBytes}: 16 MiB. */
export const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024 * 1024;

/** Default for {@link RangeReaderOptions.minMetadataReadBytes}: 64 KiB. */
export const DEFAULT_MIN_METADATA_READ_BYTES = 64 * 1024;

/** {@link ReadOptions} with the purpose filled in. */
type ResolvedReadOptions = ReadOptions & { purpose: Purpose };

/** A read waiting for the task window to close. */
interface PendingRead {
  member: StreamMember;
  /** The range to merge: the member itself, or its widened metadata block. */
  request: ByteRange;
  limiter: ConcurrencyLimiter | null | undefined;
  /** Removes the queued-abort listener once the read leaves the queue. */
  detach: () => void;
}

/** The reads of one file and purpose queued in this task. */
interface PendingGroup {
  file: FileIdentity;
  purpose: Purpose;
  reads: PendingRead[];
}

/**
 * Reads byte ranges of files over HTTP, as few streamed range requests as
 * the reads allow. Reads issued in one task are merged per file and purpose
 * ({@link mergeReads}); each merged range is one {@link RangeStream} that
 * resolves every read the moment its bytes arrive and is cancelled when no
 * read wants what is left. Everything received lands in the {@link ByteCache},
 * which later reads are served from; a read inside a request still in flight
 * attaches to it instead of starting another.
 */
export class RangeReader {
  /** Where received spans live. */
  readonly cache: ByteCache;
  /** Monotonic counters for measurement. */
  readonly stats: RangeReaderStats = {
    requests: 0,
    cancelled: 0,
    bytesRequested: 0,
    bytesReceived: 0,
    bytesOverfetched: 0,
    cacheHits: 0,
    cacheHitBytes: 0,
    attached: 0,
    validatorChanges: 0,
  };

  private readonly fetch: typeof fetch;
  private readonly maxGap: number | "median";
  private readonly maxOverfetchBytes: number;
  private readonly maxRequestBytes: number;
  private readonly minMetadataReadBytes: number;
  private readonly cacheMode: RequestCache | undefined;
  /** Queued reads by file key and purpose, flushed once per task. */
  private readonly pending = new Map<string, PendingGroup>();
  /**
   * Streams still running, by file key. Keyed without the purpose: a read
   * of either purpose may attach to a stream that covers it, and the first
   * tiles of a COG often sit inside its first metadata block.
   */
  private readonly inflight = new Map<FileKey, Set<RangeStream>>();
  /** Object sizes learned from responses, by file key. */
  private readonly sizes = new Map<FileKey, number>();
  /**
   * Each file's validator (`ETag`, or `Last-Modified`) as of its latest
   * response. Every cached span of a file matches it: a response with a
   * different one purges the file's spans before its own are stored, so the
   * cache never holds two versions of one object, as a browser's own range
   * cache never combines ranges with different validators.
   */
  private readonly validators = new Map<FileKey, string>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: RangeReaderOptions = {}) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.cache =
      options.cache !== undefined && "get" in options.cache
        ? options.cache
        : new MemoryByteCache(options.cache);
    this.maxGap = options.maxGap ?? "median";
    this.maxOverfetchBytes =
      options.maxOverfetchBytes ?? DEFAULT_MAX_OVERFETCH_BYTES;
    this.maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
    this.minMetadataReadBytes =
      options.minMetadataReadBytes ?? DEFAULT_MIN_METADATA_READ_BYTES;
    this.cacheMode = options.cacheMode;
  }

  /**
   * Read `range` of `file`. An absolute range is served from the cache, or
   * attached to a request already in flight, or queued and merged with the
   * other reads of this task; a suffix read, or a whole-object read (`range`
   * undefined), goes out at once on its own. Rejects with the signal's
   * reason if `options.signal` aborts before the bytes arrive; the request
   * itself runs on for other reads.
   */
  read(
    file: FileIdentity,
    range: ReadRange | undefined,
    options: ReadOptions,
  ): Promise<ReadResult> {
    const { signal } = options;
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    const resolved: ResolvedReadOptions =
      options.purpose === undefined
        ? { ...options, purpose: "data" }
        : (options as ResolvedReadOptions);
    if (range === undefined || "suffixLength" in range) {
      return this.single(file, range, resolved);
    }
    if (range.length === 0) {
      return Promise.resolve({ kind: "bytes", bytes: new Uint8Array(0) });
    }
    return this.lookup(file, range, resolved);
  }

  /** The cache, then in-flight streams, then the queue. */
  private async lookup(
    file: FileIdentity,
    range: ByteRange,
    options: ResolvedReadOptions,
  ): Promise<ReadResult> {
    const size = this.sizes.get(file.key);
    if (size !== undefined && range.offset >= size) {
      return { kind: "bytes", bytes: new Uint8Array(0) };
    }
    const hit = await this.cache.get(file, range, options.purpose);
    const { signal } = options;
    if (signal?.aborted) {
      throw signal.reason;
    }
    if (hit !== undefined) {
      this.stats.cacheHits += 1;
      this.stats.cacheHitBytes += range.length;
      const validator = this.validators.get(file.key);
      return validator === undefined
        ? { kind: "bytes", bytes: hit }
        : { kind: "bytes", bytes: hit, validator };
    }
    return new Promise((resolve, reject) => {
      const member: StreamMember = {
        ...range,
        resolve,
        reject,
        signal,
        getPriority: options.getPriority,
      };
      for (const stream of this.inflight.get(file.key) ?? []) {
        if (stream.attach(member)) {
          this.stats.attached += 1;
          return;
        }
      }
      this.enqueue(groupKey(file, options.purpose), file, options, member);
    });
  }

  /** One read, one request: suffix and whole-object reads never merge. */
  private single(
    file: FileIdentity,
    request: ReadRange | undefined,
    options: ResolvedReadOptions,
  ): Promise<ReadResult> {
    return new Promise((resolve, reject) => {
      const member: StreamMember = {
        offset: 0,
        length: 0,
        resolve,
        reject,
        signal: options.signal,
        getPriority: options.getPriority,
      };
      const stream = new RangeStream(
        file,
        request,
        [member],
        this.streamOptions(options.limiter),
      );
      const requested =
        request !== undefined && "suffixLength" in request
          ? request.suffixLength
          : 0;
      this.launch(file, options.purpose, stream, requested);
    });
  }

  private enqueue(
    key: string,
    file: FileIdentity,
    options: ResolvedReadOptions,
    member: StreamMember,
  ): void {
    const { signal } = options;
    let group = this.pending.get(key);
    if (group === undefined) {
      group = { file, purpose: options.purpose, reads: [] };
      this.pending.set(key, group);
    }
    const pending: PendingRead = {
      member,
      request:
        options.purpose === "metadata" &&
        member.length < this.minMetadataReadBytes
          ? widenRead(member, this.minMetadataReadBytes)
          : member,
      limiter: options.limiter,
      detach: () => {},
    };
    if (signal !== undefined) {
      const onAbort = () => {
        const queue = this.pending.get(key)?.reads;
        const at = queue?.indexOf(pending) ?? -1;
        if (queue !== undefined && at >= 0) {
          queue.splice(at, 1);
          member.reject(signal.reason);
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      pending.detach = () => signal.removeEventListener("abort", onAbort);
    }
    group.reads.push(pending);
    if (this.flushTimer === undefined) {
      this.flushTimer = setTimeout(() => this.flush(), 0);
    }
  }

  /** Close the task window: merge each group's reads and start their streams. */
  private flush(): void {
    this.flushTimer = undefined;
    const groups = [...this.pending.values()];
    this.pending.clear();
    for (const group of groups) {
      if (group.reads.length === 0) {
        continue;
      }
      for (const pending of group.reads) {
        // The stream installs its own abort handling from here on.
        pending.detach();
      }
      const { file, purpose } = group;
      const merged = mergeReads(
        group.reads.map((pending) => pending.request),
        {
          maxGap: this.maxGap,
          maxOverfetchBytes: this.maxOverfetchBytes,
          maxRequestBytes: this.maxRequestBytes,
        },
      );
      for (const range of merged) {
        const members: StreamMember[] = [];
        const kept = new Set<number>();
        for (const i of range.members) {
          const pending = group.reads[i]!;
          members.push(pending.member);
          if (
            pending.request !== pending.member &&
            !kept.has(pending.request.offset)
          ) {
            // A widened block is wanted to its end for the cache's sake, even
            // once the small read inside it has resolved; otherwise the stream
            // would be cancelled after the first chunk and the block never
            // land. It is at most `minMetadataReadBytes`, and reads of it that
            // abort do not cut it short.
            kept.add(pending.request.offset);
            members.push(keepMember(pending.request));
          }
        }
        const stream = new RangeStream(
          file,
          { offset: range.offset, length: range.length },
          members,
          this.streamOptions(group.reads[0]!.limiter),
        );
        this.stats.bytesOverfetched += range.overfetch;
        this.launch(file, purpose, stream, range.length);
      }
    }
  }

  private launch(
    file: FileIdentity,
    purpose: Purpose,
    stream: RangeStream,
    requestedBytes: number,
  ): void {
    this.stats.requests += 1;
    this.stats.bytesRequested += requestedBytes;
    let streams = this.inflight.get(file.key);
    if (streams === undefined) {
      streams = new Set();
      this.inflight.set(file.key, streams);
    }
    streams.add(stream);
    const forget = () => {
      streams.delete(stream);
      if (streams.size === 0) {
        this.inflight.delete(file.key);
      }
    };
    void stream.run().then(
      (outcome) => {
        forget();
        this.settled(file, purpose, outcome);
      },
      // `run` never rejects by contract; should it, the stream must at least
      // stop catching later reads.
      forget,
    );
  }

  private settled(
    file: FileIdentity,
    purpose: Purpose,
    outcome: StreamOutcome,
  ): void {
    this.stats.bytesReceived += outcome.bytes.length;
    if (outcome.end.kind === "cancelled") {
      this.stats.cancelled += 1;
    }
    if (outcome.validator !== undefined) {
      const known = this.validators.get(file.key);
      if (known !== undefined && known !== outcome.validator) {
        // The object was replaced: nothing cached for it may be served next
        // to the new bytes, and its size is unknown again.
        this.stats.validatorChanges += 1;
        this.sizes.delete(file.key);
        void this.cache.delete?.(file).catch(() => {});
      }
      this.validators.set(file.key, outcome.validator);
    }
    if (outcome.size !== undefined) {
      this.sizes.set(file.key, outcome.size);
    }
    if (
      outcome.offset !== undefined &&
      outcome.bytes.length > 0 &&
      outcome.end.kind !== "not-found"
    ) {
      void this.cache
        .put(file, outcome.offset, outcome.bytes, purpose)
        .catch(() => {});
    }
  }

  private streamOptions(
    limiter: ConcurrencyLimiter | null | undefined,
  ): RangeStreamOptions {
    return {
      fetch: this.fetch,
      cacheMode: this.cacheMode,
      limiter,
      maxRequestBytes: this.maxRequestBytes,
    };
  }
}

/** Reads merge only within one file identity and purpose. */
function groupKey(file: FileIdentity, purpose: Purpose): string {
  return `${file.key}\0${purpose}`;
}

/** A member that wants a range for the cache's sake and nobody waits on. */
function keepMember(range: ByteRange): StreamMember {
  return {
    offset: range.offset,
    length: range.length,
    resolve() {},
    reject() {},
  };
}
