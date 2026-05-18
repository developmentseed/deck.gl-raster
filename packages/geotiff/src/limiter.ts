import type { Source } from "@cogeotiff/core";

/** The signature of a `Source.fetch` call. */
type Fetch = Pick<Source, "fetch">["fetch"];

/**
 * Minimal contract for capping the number of concurrent {@link Source.fetch}
 * calls. An implementation hands out a fixed number of slots; callers `acquire`
 * one and call the returned release function when done.
 *
 * The optional `signal` lets a caller drop out of the queue if they no longer
 * need the request — important on browsers, where Chrome's HTTP/1.1 cap of 6
 * concurrent connections per origin means an overlong queue from a previous
 * viewport can starve a fresh one. Aborting a queued `acquire` removes it
 * before any underlying network call has fired.
 */
export interface ConcurrencyLimiter {
  /**
   * Acquire a slot. Resolves once a slot is free; call the returned function
   * exactly once when the request finishes (success or failure) to release it.
   * If `signal` aborts while waiting in the queue, the returned promise
   * rejects with the signal's `reason` and no slot is consumed.
   */
  acquire(signal?: AbortSignal): Promise<() => void>;
}

/**
 * Wrap a `Source.fetch` so each call holds a {@link ConcurrencyLimiter} slot
 * for its duration — releasing it whether the fetch resolves or rejects, and
 * never otherwise interfering. The call's own `options.signal` is forwarded to
 * `acquire`, so if the caller aborts before reaching the front of the queue
 * the limiter drops them without firing a request.
 */
export function limitFetch(fetch: Fetch, limiter: ConcurrencyLimiter): Fetch {
  return async (offset, length, options) => {
    const release = await limiter.acquire(options?.signal);
    try {
      return await fetch(offset, length, options);
    } finally {
      release();
    }
  };
}

/** A waiter parked in a {@link Semaphore}'s queue. */
type Waiter = {
  readonly signal?: AbortSignal;
  resolve(release: () => void): void;
  reject(reason: unknown): void;
};

/**
 * A simple FIFO semaphore implementing {@link ConcurrencyLimiter}. Hands out up
 * to `maxRequests` slots; queued acquires that abort are removed from the queue
 * before any request is issued.
 */
export class Semaphore implements ConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly maxRequests: number) {
    if (!(maxRequests >= 1)) {
      throw new RangeError(
        `Semaphore maxRequests must be >= 1, got ${maxRequests}`,
      );
    }
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    if (this.active < this.maxRequests) {
      this.active++;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { signal, resolve, reject };
      this.waiters.push(waiter);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            const i = this.waiters.indexOf(waiter);
            if (i >= 0) {
              this.waiters.splice(i, 1);
              reject(signal.reason);
            }
          },
          { once: true },
        );
      }
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active--;
      const next = this.waiters.shift();
      if (next) {
        this.active++;
        next.resolve(this.makeRelease());
      }
    };
  }
}

/**
 * Default {@link ConcurrencyLimiter}s cached by URL origin. Chrome (and most
 * browsers) cap concurrent HTTP/1.1 connections per origin to 6; over-scheduling
 * past that point means the browser queues requests, which is bad for tile
 * fetching because stale-after-pan requests then block fresh ones. This module
 * gives every `fromUrl` (and any other source-level caller) a shared per-origin
 * semaphore so the cap holds across layers / data formats targeting one host.
 */
const DEFAULT_MAX_REQUESTS_PER_ORIGIN = 6;
const limiterByOrigin = new Map<string, ConcurrencyLimiter>();

/**
 * Return a shared {@link ConcurrencyLimiter} for `url`'s origin. The first call
 * for a given origin constructs one with `maxRequests = 6`; subsequent calls
 * return the same instance, so multiple sources (COG, Zarr, …) targeting the
 * same host share one cap.
 */
export function defaultLimiterForOrigin(url: string | URL): ConcurrencyLimiter {
  const origin = new URL(url).origin;
  let limiter = limiterByOrigin.get(origin);
  if (!limiter) {
    limiter = new Semaphore(DEFAULT_MAX_REQUESTS_PER_ORIGIN);
    limiterByOrigin.set(origin, limiter);
  }
  return limiter;
}
