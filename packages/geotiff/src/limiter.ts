/** A pending acquire waiting for a slot. */
interface Waiter {
  resolve(release: () => void): void;
  reject(reason: unknown): void;
  signal?: AbortSignal;
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
