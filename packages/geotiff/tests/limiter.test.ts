import { describe, expect, it } from "vitest";
import type { ConcurrencyLimiter } from "../src/limiter.js";
import { PerOriginSemaphore, Semaphore } from "../src/limiter.js";

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

describe("PerOriginSemaphore", () => {
  const A = new URL("https://a.example.com/file-1.tif");
  const A2 = new URL("https://a.example.com/file-2.tif");
  const B = new URL("https://b.example.com/file-1.tif");

  it("implements ConcurrencyLimiter", () => {
    const limiter: ConcurrencyLimiter = new PerOriginSemaphore({
      maxRequests: 2,
    });
    expect(typeof limiter.acquire).toBe("function");
  });

  it("acquire/release works for one origin", async () => {
    const limiter = new PerOriginSemaphore({ maxRequests: 1 });
    const release = await limiter.acquire(A);
    let secondResolved = false;
    const second = limiter.acquire(A2).then((r) => {
      secondResolved = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(secondResolved).toBe(false); // same origin, queued
    release();
    (await second)();
  });

  it("different origins don't compete: saturating origin A doesn't block origin B", async () => {
    const limiter = new PerOriginSemaphore({ maxRequests: 1 });
    const holdA = await limiter.acquire(A);
    // origin A is saturated. origin B should still grant immediately.
    let bResolved = false;
    const b = limiter.acquire(B).then((r) => {
      bResolved = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(bResolved).toBe(true);
    holdA();
    (await b)();
  });

  it("same origin URLs with different paths share one pool", async () => {
    const limiter = new PerOriginSemaphore({ maxRequests: 1 });
    const holdA1 = await limiter.acquire(A);
    let a2Resolved = false;
    const a2 = limiter.acquire(A2).then((r) => {
      a2Resolved = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(a2Resolved).toBe(false);
    holdA1();
    (await a2)();
  });

  it("mints a new per-origin Semaphore lazily on first acquire", async () => {
    const limiter = new PerOriginSemaphore({ maxRequests: 1 });
    // Saturate origin A.
    const hold = await limiter.acquire(A);
    // A brand-new origin C should resolve immediately even though A is full.
    const C = new URL("https://c.example.com/file.tif");
    const release = await limiter.acquire(C);
    expect(typeof release).toBe("function");
    release();
    hold();
  });
});
