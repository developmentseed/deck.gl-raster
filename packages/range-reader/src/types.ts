import type { ConcurrencyLimiter, Priority } from "./limiter.js";

/**
 * What a read is for. Header reads (file structure: IFDs, offset tables,
 * metadata) and data reads (tile or chunk bytes) are merged and cached
 * separately, so data churn never evicts the small reads every later read
 * depends on.
 */
export type Purpose = "header" | "data";

/** A byte range: `length` bytes starting at `offset`. */
export interface ByteRange {
  offset: number;
  length: number;
}

/**
 * What to read from a file: an absolute {@link ByteRange}, the last
 * `suffixLength` bytes, or `undefined` for the whole object.
 */
export type ReadRange = ByteRange | { suffixLength: number } | undefined;

/**
 * The outcome of a read. `not-found` is a distinct outcome rather than an
 * error because a missing object is data for some formats (a missing Zarr
 * chunk means its fill value) and an error for others (a missing COG).
 */
export type ReadResult =
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "not-found" };

/**
 * One file as the reader sees it: its URL plus the request parameters it is
 * read with. Reads of one identity may share a request and a cache span;
 * reads of different identities never do, so two layers reading one URL
 * with different credentials never see each other's bytes. Build one with
 * {@link fileIdentity} and keep it for the file's lifetime.
 */
export interface FileIdentity {
  readonly url: URL;
  /** Headers, credentials and mode sent with every request for this file. */
  readonly init?: RequestInit;
  /** `url.href` + `"\0"` + the canonical signature of `init`. */
  readonly key: string;
}

/** Per-read options for {@link RangeReader.read}. */
export interface ReadOptions {
  purpose: Purpose;
  /** Ends this read's wait; never aborts a request another read still wants. */
  signal?: AbortSignal;
  /** Re-evaluated by the limiter on every slot-open; lower is served sooner. */
  getPriority?: () => Priority;
  /** Caps concurrent requests; one slot per merged request. */
  limiter?: ConcurrencyLimiter | null;
}

/**
 * Where received byte spans live. The default is {@link MemoryByteCache};
 * a user can supply a disk-backed one. Both methods are asynchronous so a
 * cache can live outside memory. A cache only holds bytes: in-flight
 * requests and the not-found outcome stay in the reader.
 */
export interface ByteCache {
  /** The bytes of `range` if one stored span contains all of it. */
  get(
    file: FileIdentity,
    range: ByteRange,
    purpose: Purpose,
  ): Promise<Uint8Array | undefined>;
  /** Store a received span. The cache decides what to keep and for how long. */
  put(
    file: FileIdentity,
    offset: number,
    bytes: Uint8Array,
    purpose: Purpose,
  ): Promise<void>;
  /** Bytes currently held for `purpose`, when the cache can tell. */
  byteSize?(purpose: Purpose): number;
}

/** Monotonic counters kept by a {@link RangeReader} for measurement. */
export interface RangeReaderStats {
  /** Merged requests sent. */
  requests: number;
  /** Requests cancelled before their body ended. */
  cancelled: number;
  /** Bytes asked for across all requests. */
  bytesRequested: number;
  /** Bytes that arrived. */
  bytesReceived: number;
  /** Requested bytes no read covered: the gaps merged across. */
  bytesOverfetched: number;
  /** Reads served from the cache. */
  cacheHits: number;
  /** Bytes served from the cache. */
  cacheHitBytes: number;
  /** Reads attached to a request already in flight. */
  attached: number;
}

/** Options for {@link RangeReader}. */
export interface RangeReaderOptions {
  /** Transport. Defaults to `globalThis.fetch`; tests and custom auth replace it. */
  fetch?: typeof fetch;
  /**
   * Byte budgets of the default in-memory cache, by purpose, or a
   * user-supplied {@link ByteCache}.
   */
  cache?: { headerBytes?: number; dataBytes?: number } | ByteCache;
  /**
   * Largest gap between two reads that still share a request. `"median"`
   * uses the batch's median read length.
   */
  maxGap?: number | "median";
  /** Largest number of bytes in one request that no read covers. */
  maxOverfetchBytes?: number;
  /** Largest merged request; also the largest whole object accepted from a server that ignores `Range`. */
  maxRequestBytes?: number;
  /** Header reads shorter than this are widened to an aligned block of this size. */
  minHeaderReadBytes?: number;
  /** `RequestInit.cache` for every request. Default: the browser's default. */
  cacheMode?: RequestCache;
}
