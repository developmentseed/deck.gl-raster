import type { Source } from "@cogeotiff/core";

/** The shape of a {@link Source.fetch} call. */
type Fetch = Pick<Source, "fetch">["fetch"];

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
}

/**
 * Counting semaphore with FIFO queueing and abort-aware acquire. Internal
 * primitive used by {@link PerOriginSemaphore} and {@link limitFetch}.
 *
 * Hands out up to `maxRequests` concurrent slots. Further `acquire()`s queue.
 * Acquires with an `AbortSignal` reject (and never consume a slot) if the
 * signal aborts before the slot is granted — either because it's already
 * aborted at call time, or because it aborts while queued.
 */
export class Semaphore {
  private active = 0;
  private readonly maxRequests: number;
  private readonly queue: Waiter[] = [];

  constructor(options: { maxRequests: number }) {
    this.maxRequests = options.maxRequests;
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    if (this.active < this.maxRequests) {
      this.active += 1;
      return Promise.resolve(this._makeRelease());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
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

  /** Hand off one slot: dequeue the next waiter and grant it the slot, or —
   *  if the queue is empty — decrement {@link Semaphore.active} so the next
   *  `acquire` can take it directly. */
  private _releaseOne(): void {
    const next = this.queue.shift();
    if (!next) {
      this.active -= 1;
      return;
    }
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
   */
  acquire(url: URL, signal?: AbortSignal): Promise<() => void>;
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

  acquire(url: URL, signal?: AbortSignal): Promise<() => void> {
    const { origin } = url;
    let sem = this.byOrigin.get(origin);
    if (!sem) {
      sem = new Semaphore({ maxRequests: this.maxRequests });
      this.byOrigin.set(origin, sem);
    }
    return sem.acquire(signal);
  }
}

/**
 * Wrap a `Source.fetch` so each call holds a {@link ConcurrencyLimiter} slot
 * for its duration — releasing on resolve, on reject, and never otherwise
 * interfering. Forwards `options.signal` to `limiter.acquire`, so if the
 * caller aborts while the call is queued the request is dropped before any
 * network I/O fires.
 */
export function limitFetch(
  fetch: Fetch,
  url: URL,
  limiter: ConcurrencyLimiter,
): Fetch {
  return async (offset, length, options) => {
    const release = await limiter.acquire(url, options?.signal);
    try {
      return await fetch(offset, length, options);
    } finally {
      release();
    }
  };
}
