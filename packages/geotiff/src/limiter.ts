import type {
  SourceCallback,
  SourceMiddleware,
  SourceRequest,
} from "@chunkd/source";
import type {
  ConcurrencyLimiter,
  Priority,
} from "@developmentseed/range-reader";

/** Options for {@link LimiterMiddleware}. */
interface LimiterMiddlewareOptions {
  /** The URL the wrapped source is reading from. Passed to
   *  `limiter.acquire(url, signal?)` on every fetch — the limiter uses it for
   *  per-origin routing. */
  url: URL;
  /** The {@link ConcurrencyLimiter} to gate through. */
  limiter: ConcurrencyLimiter;
  /** Optional dynamic priority for every fetch through this middleware. The
   *  limiter re-invokes this callback on each slot-open, so closures over
   *  dynamic state (e.g. layer viewport center) re-sort the queue when that
   *  state changes. Lower = serviced sooner. */
  getPriority?: () => Priority;
}

/**
 * chunkd middleware that holds a {@link ConcurrencyLimiter} slot for the
 * duration of each underlying `fetch` — releasing on resolve, on reject, and
 * never otherwise interfering. Forwards the request's `signal` to
 * `limiter.acquire`, so if the caller aborts while the call is queued the
 * request is dropped before any network I/O fires.
 *
 * Composed into a {@link SourceView}'s middleware list alongside other
 * middlewares (`SourceChunk`, `LRUCacheMiddleware`, …). Place it after
 * caching so cache hits don't burn a slot.
 *
 * @example
 * ```ts
 * import { SourceView } from "@chunkd/source";
 * import { SourceChunk } from "@chunkd/middleware";
 *
 * const view = new SourceView(source, [
 *   new SourceChunk({ size: 64 * 1024 }),
 *   new LRUCacheMiddleware({ size: 8 * 1024 * 1024 }),
 *   new LimiterMiddleware({ url, limiter }),
 * ]);
 * ```
 *
 * @internal
 */
export class LimiterMiddleware implements SourceMiddleware {
  readonly name = "limiter";
  private readonly url: URL;
  private readonly limiter: ConcurrencyLimiter;
  private readonly getPriority?: () => Priority;

  constructor(opts: LimiterMiddlewareOptions) {
    this.url = opts.url;
    this.limiter = opts.limiter;
    this.getPriority = opts.getPriority;
  }

  async fetch(req: SourceRequest, next: SourceCallback): Promise<ArrayBuffer> {
    const release = await this.limiter.acquire(
      this.url,
      req.signal,
      this.getPriority,
    );
    try {
      return await next(req);
    } finally {
      release();
    }
  }
}
