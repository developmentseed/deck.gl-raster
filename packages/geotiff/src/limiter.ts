import type { Source, SourceMetadata } from "@chunkd/source";

/**
 * Numeric priority used to order waiters in a {@link Semaphore}'s queue. Lower
 * = serviced sooner. A single `number` is equivalent to a 1-tuple; arrays are
 * compared lexicographically (element-wise), with missing trailing elements
 * treated as 0. Returning `0` (or omitting `getPriority` entirely) makes the
 * waiter effectively un-prioritized — FIFO arrival order wins among ties.
 */
export type Priority = number | readonly number[];

/**
 * Normalize priority value: `undefined` or `NaN` becomes 0, so it sorts as un-prioritized.
 *
 * Coercing `NaN` matters because `NaN < x` and `NaN > x` both resolve to false,
 * so a `getPriority` that returns `NaN` (e.g. a distance from a degenerate
 * viewport) would otherwise compare as a tie with everything and silently
 * mis-sort, rather than falling back to FIFO.
 */
function normalizePriority(value: number | undefined): number {
  return value === undefined || Number.isNaN(value) ? 0 : value;
}

/**
 * Compare two priorities. Returns negative if `a` should be serviced before
 * `b`, positive if `b` should go first, 0 on tie (queue then breaks the tie
 * by FIFO arrival order). Both shapes are normalised to arrays for compare.
 */
function comparePriorities(a: Priority, b: Priority): number {
  const arrA = typeof a === "number" ? [a] : a;
  const arrB = typeof b === "number" ? [b] : b;
  const len = Math.max(arrA.length, arrB.length);
  for (let i = 0; i < len; i++) {
    const ai = normalizePriority(arrA[i]);
    const bi = normalizePriority(arrB[i]);
    if (ai < bi) {
      return -1;
    }
    if (ai > bi) {
      return 1;
    }
  }
  return 0;
}

/** A pending acquire parked in {@link Semaphore.queue}, waiting for a slot. */
interface Waiter {
  /** Settles the caller's `acquire(...)` promise with a release function. */
  resolve(release: () => void): void;
  /** Settles the caller's `acquire(...)` promise as rejected (e.g. on abort). */
  reject(reason: unknown): void;
  /** Optional caller-supplied signal. If it aborts while we're queued, the
   *  waiter is spliced out and {@link Waiter.reject reject}ed. */
  signal?: AbortSignal;
  /** The listener installed on `signal` so we can later
   *  `removeEventListener("abort", onAbort)` when the slot is granted. */
  onAbort?: () => void;
  /** Dynamic priority callback. Re-invoked by `_releaseOne` on every slot-
   *  open so the queue can re-sort if priorities have changed (e.g. viewport
   *  panned, distance-from-center changed). Omitted = priority 0. */
  getPriority?: () => Priority;
}

/**
 * Counting semaphore with abort-aware acquire and dynamic priority. Internal
 * primitive used by {@link PerOriginSemaphore} and {@link LimitedSource}.
 *
 * Hands out up to `maxRequests` concurrent slots. Further `acquire()`s queue.
 * On every slot-open, the queue is searched for the lowest-priority waiter
 * (re-evaluating `getPriority` on each — so panning the viewport re-sorts the
 * queue if callers' priorities depend on viewport state). Ties break by FIFO
 * arrival order. A `Semaphore` with no priorities is therefore equivalent to
 * a plain FIFO queue.
 *
 * Acquires with an `AbortSignal` reject (and never consume a slot) if the
 * signal aborts before the slot is granted — either because it's already
 * aborted at call time, or because it aborts while queued.
 *
 * We use a single linear-scan find-min instead of a priority queue (heap)
 * because priorities are *dynamic* — we have to re-evaluate every waiter's
 * `getPriority` on each release anyway, which costs O(N). Linear scan + find-
 * min in the same pass also costs O(N), with a smaller constant and simpler
 * code; a heap would only win if we extracted multiple minima per release,
 * which we don't (one slot opens at a time).
 */
export class Semaphore {
  private active = 0;
  private readonly maxRequests: number;
  private readonly queue: Waiter[] = [];

  constructor(options: { maxRequests: number }) {
    this.maxRequests = options.maxRequests;
  }

  acquire(
    signal?: AbortSignal,
    getPriority?: () => Priority,
  ): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    if (this.active < this.maxRequests) {
      this.active += 1;
      return Promise.resolve(this._makeRelease());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal, getPriority };
      if (signal) {
        const onAbort = () => {
          const idx = this.queue.indexOf(waiter);
          if (idx >= 0) {
            this.queue.splice(idx, 1);
            reject(signal.reason);
          }
        };
        waiter.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  /** Build a single-use release function for a freshly-granted slot.
   *  Calls beyond the first are no-ops, so double-releasing is safe. */
  private _makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this._releaseOne();
    };
  }

  /** Hand off one slot: pick the lowest-priority waiter (re-evaluating each
   *  waiter's `getPriority` for dynamic ordering), grant it the slot — or, if
   *  the queue is empty, decrement {@link Semaphore.active} so the next
   *  `acquire` can take the freed slot directly. FIFO break on ties. */
  private _releaseOne(): void {
    if (this.queue.length === 0) {
      this.active -= 1;
      return;
    }
    // Linear scan find-min. `bestIdx === 0` initially gives the earliest
    // arrival the implicit tiebreaker — only strictly-lower priorities can
    // bump it.
    let bestIdx = 0;
    let bestPrio: Priority = this.queue[0]!.getPriority?.() ?? 0;
    for (let i = 1; i < this.queue.length; i++) {
      const p: Priority = this.queue[i]!.getPriority?.() ?? 0;
      if (comparePriorities(p, bestPrio) < 0) {
        bestIdx = i;
        bestPrio = p;
      }
    }
    const next = this.queue.splice(bestIdx, 1)[0]!;
    if (next.signal && next.onAbort) {
      next.signal.removeEventListener("abort", next.onAbort);
    }
    // Hand the slot directly to the next waiter — `active` stays the same
    // because we're transferring ownership, not freeing and re-taking.
    next.resolve(this._makeRelease());
  }
}

/**
 * Minimal contract for capping concurrent {@link Source.fetch} calls. An
 * implementation hands out slots scoped however it likes; the default
 * {@link PerOriginSemaphore} scopes per `url.origin`.
 */
export interface ConcurrencyLimiter {
  /**
   * Acquire a slot to perform one fetch to `url`. Resolves to a release
   * function — call it exactly once when the fetch settles. If `signal`
   * aborts while waiting in the queue, the returned promise rejects with the
   * signal's reason and no slot is consumed.
   *
   * `getPriority` is an optional callback re-evaluated by the limiter on
   * every slot-open, so queued waiters can be re-ordered if their priority
   * depends on dynamic state (e.g. distance from viewport center, which
   * changes on pan). Lower-numeric = serviced sooner. A tuple sorts
   * lexicographically. Omitted = priority 0, FIFO among ties.
   */
  acquire(
    url: URL,
    signal?: AbortSignal,
    getPriority?: () => Priority,
  ): Promise<() => void>;
}

/**
 * Default {@link ConcurrencyLimiter}. Maintains a separate {@link Semaphore}
 * per `url.origin`, minted lazily on first encounter. Multiple consumers (e.g.
 * two `COGLayer`s on the same S3 bucket) targeting one origin share that
 * origin's slot pool; consumers targeting different origins don't compete.
 *
 * The browser's HTTP/1.1 per-origin connection cap (~6 on Chrome) is the
 * reason the cap is *per origin*, shared across layers — exceeding it just
 * makes the browser queue requests, blocking fresh ones behind stale ones.
 */
export class PerOriginSemaphore implements ConcurrencyLimiter {
  private readonly maxRequests: number;
  private readonly byOrigin = new Map<string, Semaphore>();

  constructor(options: { maxRequests: number }) {
    this.maxRequests = options.maxRequests;
  }

  acquire(
    url: URL,
    signal?: AbortSignal,
    getPriority?: () => Priority,
  ): Promise<() => void> {
    const { origin } = url;
    let sem = this.byOrigin.get(origin);
    if (!sem) {
      sem = new Semaphore({ maxRequests: this.maxRequests });
      this.byOrigin.set(origin, sem);
    }
    return sem.acquire(signal, getPriority);
  }
}

/** Options for {@link LimitedSource}. */
interface LimitedSourceOptions {
  /** The {@link ConcurrencyLimiter} to gate through. The wrapped source's
   *  own `url` is passed to `limiter.acquire` for per-origin routing. */
  limiter: ConcurrencyLimiter;
  /** Optional dynamic priority for every fetch through this source. The
   *  limiter re-invokes this callback on each slot-open, so closures over
   *  dynamic state (e.g. layer viewport center) re-sort the queue when that
   *  state changes. Lower = serviced sooner. */
  getPriority?: () => Priority;
}

/**
 * Wraps a {@link Source} so every `fetch` holds a {@link ConcurrencyLimiter}
 * slot for its duration — acquiring before the read, releasing when it settles
 * (resolve or reject). Forwards the read's `signal` to `limiter.acquire`, so a
 * request whose caller aborts while it is still queued for a slot is dropped
 * before any network I/O fires.
 *
 * Compose this *beneath* `SourceChunk` / `SourceCache` (i.e. as the
 * `SourceView`'s underlying source), so a cache hit short-circuits in
 * `SourceCache` and never reaches — never burns a slot on — the limiter:
 *
 * @example
 * ```ts
 * import { SourceView } from "@chunkd/source";
 * import { SourceCache, SourceChunk } from "@chunkd/middleware";
 *
 * const limited = new LimitedSource(source, { limiter });
 * const view = new SourceView(limited, [
 *   new SourceChunk({ size: 64 * 1024 }),
 *   new SourceCache({ size: 8 * 1024 * 1024 }),
 * ]);
 * ```
 *
 * **Why a source wrapper and not a chunkd `SourceMiddleware`** (which would
 * compose more naturally): chunkd's `SourceView` does not forward the request
 * `signal` to its middleware, so a middleware cannot observe an abort — only
 * the underlying source receives the read options (incl. `signal`) via
 * `SourceView`'s terminal handler. Wrapping the source is therefore the only
 * layer that can drop a queued request on abort. Revert to a `SourceMiddleware`
 * once chunkd forwards the signal (https://github.com/blacha/chunkd/pull/1697);
 * tracked in https://github.com/developmentseed/deck.gl-raster/issues/565.
 *
 * @internal
 */
export class LimitedSource implements Source {
  private readonly source: Source;
  private readonly limiter: ConcurrencyLimiter;
  private readonly getPriority?: () => Priority;

  constructor(source: Source, opts: LimitedSourceOptions) {
    this.source = source;
    this.limiter = opts.limiter;
    this.getPriority = opts.getPriority;
  }

  get type(): string {
    return this.source.type;
  }

  get url(): URL {
    return this.source.url;
  }

  get metadata(): SourceMetadata | undefined {
    return this.source.metadata;
  }

  head(options?: { signal: AbortSignal }): Promise<SourceMetadata> {
    return this.source.head(options);
  }

  async fetch(
    offset: number,
    length?: number,
    options?: { signal: AbortSignal },
  ): Promise<ArrayBuffer> {
    const release = await this.limiter.acquire(
      this.source.url,
      options?.signal,
      this.getPriority,
    );
    try {
      return await this.source.fetch(offset, length, options);
    } finally {
      release();
    }
  }
}
