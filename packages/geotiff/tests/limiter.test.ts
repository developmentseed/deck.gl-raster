import { describe, expect, it } from "vitest";
import { Semaphore } from "../src/limiter.js";

describe("Semaphore", () => {
  it("allows up to maxRequests concurrent acquires; further acquires queue", async () => {
    const sem = new Semaphore({ maxRequests: 2 });
    const a = await sem.acquire();
    const b = await sem.acquire();
    let cResolved = false;
    const cPromise = sem.acquire().then((release) => {
      cResolved = true;
      return release;
    });
    // give the microtask queue a chance — c must NOT resolve while a+b hold slots
    await new Promise((r) => setTimeout(r, 0));
    expect(cResolved).toBe(false);
    a();
    const c = await cPromise;
    expect(cResolved).toBe(true);
    b();
    c();
  });

  it("waiters resolve in FIFO order", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const hold = await sem.acquire();
    const order: number[] = [];
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

  it("acquire(signal) with already-aborted signal rejects and consumes no slot", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const ac = new AbortController();
    ac.abort(new Error("nope"));
    await expect(sem.acquire(ac.signal)).rejects.toThrow("nope");
    // The slot was never consumed — a fresh acquire should resolve immediately.
    const release = await sem.acquire();
    expect(typeof release).toBe("function");
    release();
  });

  it("aborting a queued acquire rejects it and frees its queue slot", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const hold = await sem.acquire();
    const ac = new AbortController();
    const queued = sem.acquire(ac.signal);
    ac.abort(new Error("pan-away"));
    await expect(queued).rejects.toThrow("pan-away");
    // A fresh acquire (no signal) should be next-in-line, not blocked behind the aborted one.
    let nextResolved = false;
    const next = sem.acquire().then((r) => {
      nextResolved = true;
      return r;
    });
    hold();
    await next;
    expect(nextResolved).toBe(true);
  });
});
