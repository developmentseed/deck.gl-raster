import { describe, expect, it } from "vitest";
import type { ConcurrencyLimiter } from "../src/limiter.js";
import {
  defaultLimiterForOrigin,
  limitFetch,
  Semaphore,
} from "../src/limiter.js";

/** A limiter that records acquire/release order and only ever allows
 *  `maxConcurrent` slots, for deterministic assertions. */
function makeRecordingLimiter(maxConcurrent = Number.POSITIVE_INFINITY) {
  const log: string[] = [];
  let active = 0;
  const waiters: Array<() => void> = [];
  const limiter: ConcurrencyLimiter = {
    acquire: () =>
      new Promise<() => void>((resolve) => {
        const grant = () => {
          active++;
          log.push(`acquire(active=${active})`);
          resolve(() => {
            active--;
            log.push(`release(active=${active})`);
            const next = waiters.shift();
            if (next) {
              next();
            }
          });
        };
        if (active < maxConcurrent) {
          grant();
        } else {
          waiters.push(grant);
        }
      }),
  };
  return { limiter, log };
}

describe("limitFetch", () => {
  it("holds a slot for the duration of the underlying fetch (success)", async () => {
    const { limiter, log } = makeRecordingLimiter();
    const buf = new ArrayBuffer(8);
    const fetch = limitFetch(async () => {
      log.push("fetch");
      return buf;
    }, limiter);
    const result = await fetch(0, 8);
    expect(result).toBe(buf);
    expect(log).toEqual(["acquire(active=1)", "fetch", "release(active=0)"]);
  });

  it("releases the slot even when the underlying fetch throws", async () => {
    const { limiter, log } = makeRecordingLimiter();
    const fetch = limitFetch(async () => {
      log.push("fetch");
      throw new Error("boom");
    }, limiter);
    await expect(fetch(0, 8)).rejects.toThrow("boom");
    expect(log).toEqual(["acquire(active=1)", "fetch", "release(active=0)"]);
  });

  it("forwards offset/length/options to the wrapped fetch", async () => {
    const { limiter } = makeRecordingLimiter();
    const calls: Array<unknown[]> = [];
    const fetch = limitFetch(async (...args) => {
      calls.push(args);
      return new ArrayBuffer(0);
    }, limiter);
    const signal = new AbortController().signal;
    await fetch(123, 456, { signal });
    expect(calls).toEqual([[123, 456, { signal }]]);
  });

  it("forwards the caller's signal to acquire (queued aborts drop)", async () => {
    const sem = new Semaphore(1);
    // Hold the only slot so the next acquire queues.
    const holdRelease = await sem.acquire();
    const ac = new AbortController();
    const fetch = limitFetch(async () => new ArrayBuffer(0), sem);
    const pending = fetch(0, 8, { signal: ac.signal });
    ac.abort(new Error("user panned away"));
    await expect(pending).rejects.toThrow("user panned away");
    holdRelease();
  });
});

describe("Semaphore", () => {
  it("hands out up to maxRequests slots concurrently", async () => {
    const sem = new Semaphore(2);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    let r3Acquired = false;
    const p3 = sem.acquire().then((r) => {
      r3Acquired = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(r3Acquired).toBe(false); // queued
    r1();
    const r3 = await p3;
    expect(r3Acquired).toBe(true);
    r2();
    r3();
  });

  it("rejects a queued acquire when its signal aborts; does not consume a slot", async () => {
    const sem = new Semaphore(1);
    const hold = await sem.acquire();
    const ac = new AbortController();
    const pending = sem.acquire(ac.signal);
    ac.abort(new Error("dropped"));
    await expect(pending).rejects.toThrow("dropped");
    // The slot was never granted — releasing the holder must let a *new* acquire through.
    hold();
    const r = await Promise.race([
      sem.acquire().then(() => "got" as const),
      new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 50)),
    ]);
    expect(r).toBe("got");
  });

  it("rejects immediately when acquire is called with an already-aborted signal", async () => {
    const sem = new Semaphore(1);
    const ac = new AbortController();
    ac.abort(new Error("pre-aborted"));
    await expect(sem.acquire(ac.signal)).rejects.toThrow("pre-aborted");
    // No slot was consumed.
    const r = await sem.acquire();
    expect(typeof r).toBe("function");
    r();
  });

  it("FIFO: queued waiters are granted in arrival order", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const hold = await sem.acquire();
    const p1 = sem.acquire().then((r) => {
      order.push(1);
      r();
    });
    const p2 = sem.acquire().then((r) => {
      order.push(2);
      r();
    });
    const p3 = sem.acquire().then((r) => {
      order.push(3);
      r();
    });
    hold();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("rejects construction with maxRequests < 1", () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
  });
});

describe("defaultLimiterForOrigin", () => {
  it("returns the same instance for the same origin", () => {
    const a = defaultLimiterForOrigin("https://example.com/a/foo.tif");
    const b = defaultLimiterForOrigin("https://example.com/b/bar.tif");
    expect(b).toBe(a);
  });

  it("returns distinct instances for distinct origins", () => {
    const a = defaultLimiterForOrigin("https://example.com/x.tif");
    const b = defaultLimiterForOrigin("https://other.example.org/x.tif");
    expect(b).not.toBe(a);
  });

  it("accepts a URL object", () => {
    const a = defaultLimiterForOrigin("https://example.com/p.tif");
    const b = defaultLimiterForOrigin(new URL("https://example.com/q.tif"));
    expect(b).toBe(a);
  });
});
