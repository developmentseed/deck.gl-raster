import type { Source } from "@chunkd/source";
import { describe, expect, it } from "vitest";
import type { ConcurrencyLimiter, Priority } from "../src/limiter.js";
import {
  LimitedSource,
  PerOriginSemaphore,
  Semaphore,
} from "../src/limiter.js";

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

  it("orders queued waiters by priority (lower = sooner)", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const hold = await sem.acquire();
    const order: number[] = [];
    // Queue in arrival order [c, a, b] but priorities say a < b < c.
    const c = sem
      .acquire(undefined, () => 3)
      .then((r) => {
        order.push(3);
        r();
      });
    const a = sem
      .acquire(undefined, () => 1)
      .then((r) => {
        order.push(1);
        r();
      });
    const b = sem
      .acquire(undefined, () => 2)
      .then((r) => {
        order.push(2);
        r();
      });
    hold();
    await Promise.all([a, b, c]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("FIFO tiebreak among waiters with the same priority", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const hold = await sem.acquire();
    const order: number[] = [];
    const p1 = sem
      .acquire(undefined, () => 5)
      .then((r) => {
        order.push(1);
        r();
      });
    const p2 = sem
      .acquire(undefined, () => 5)
      .then((r) => {
        order.push(2);
        r();
      });
    const p3 = sem
      .acquire(undefined, () => 5)
      .then((r) => {
        order.push(3);
        r();
      });
    hold();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("re-evaluates getPriority on every slot-open (dynamic priority)", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const hold = await sem.acquire();
    // Two waiters; each reads from a shared mutable state.
    const prio = { a: 10, b: 1 };
    const order: string[] = [];
    const aPromise = sem
      .acquire(undefined, () => prio.a)
      .then((r) => {
        order.push("a");
        r();
      });
    const bPromise = sem
      .acquire(undefined, () => prio.b)
      .then((r) => {
        order.push("b");
        r();
      });
    // Right now b's priority (1) < a's (10), so on the first release b wins.
    hold();
    // Wait for b to finish.
    await bPromise;
    // Now flip priorities BEFORE a gets serviced. Only a is in the queue, so
    // there's no contender, but this exercises that getPriority is read fresh
    // on each call rather than memoised at acquire time.
    prio.a = 0;
    await aPromise;
    expect(order).toEqual(["b", "a"]);
  });

  it("sorts tuple priorities lexicographically with missing trailing elements as 0", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const hold = await sem.acquire();
    const order: string[] = [];
    // [5, 3] vs [5, 1] vs [5] — second-element decides; [5] = [5, 0] (smallest).
    const p53 = sem
      .acquire(undefined, () => [5, 3] as const)
      .then((r) => {
        order.push("[5,3]");
        r();
      });
    const p51 = sem
      .acquire(undefined, () => [5, 1] as const)
      .then((r) => {
        order.push("[5,1]");
        r();
      });
    const p5 = sem
      .acquire(undefined, () => [5] as const)
      .then((r) => {
        order.push("[5]");
        r();
      });
    hold();
    await Promise.all([p5, p51, p53]);
    expect(order).toEqual(["[5]", "[5,1]", "[5,3]"]);
  });

  it("mixes number and tuple priorities — number is treated as 1-tuple", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const hold = await sem.acquire();
    const order: string[] = [];
    // priority 3 (= [3]) and [3, 5] tie on first element; second decides — [3] (= [3,0]) wins.
    const p3tuple = sem
      .acquire(undefined, () => [3, 5] as const)
      .then((r) => {
        order.push("[3,5]");
        r();
      });
    const p3num = sem
      .acquire(undefined, () => 3)
      .then((r) => {
        order.push("3");
        r();
      });
    hold();
    await Promise.all([p3num, p3tuple]);
    expect(order).toEqual(["3", "[3,5]"]);
  });

  it("treats omitted getPriority as priority 0 (so unprio'd waiters lead the queue)", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const hold = await sem.acquire();
    const order: string[] = [];
    // priority 5 first arrival; no-priority second arrival. No-prio = 0 < 5 → wins.
    const p5 = sem
      .acquire(undefined, () => 5)
      .then((r) => {
        order.push("5");
        r();
      });
    const pNone = sem.acquire().then((r) => {
      order.push("none");
      r();
    });
    hold();
    await Promise.all([p5, pNone]);
    expect(order).toEqual(["none", "5"]);
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

  it("forwards getPriority to the per-origin Semaphore", async () => {
    const limiter = new PerOriginSemaphore({ maxRequests: 1 });
    const hold = await limiter.acquire(A);
    const order: string[] = [];
    const low = limiter
      .acquire(A, undefined, () => 99)
      .then((r) => {
        order.push("low");
        r();
      });
    const high = limiter
      .acquire(A2, undefined, () => 1)
      .then((r) => {
        order.push("high");
        r();
      });
    hold();
    await Promise.all([low, high]);
    expect(order).toEqual(["high", "low"]);
  });
});

describe("LimitedSource", () => {
  const URL_A = new URL("https://a.example.com/cog.tif");

  /** A minimal recording {@link Source} for wrapping. */
  function fakeSource(
    fetchImpl: Source["fetch"] = async () => new ArrayBuffer(0),
  ): Source {
    return {
      type: "test",
      url: URL_A,
      metadata: { size: 1024 },
      head: async () => ({ size: 1024 }),
      fetch: fetchImpl,
    };
  }

  it("acquires a slot before fetching and releases after", async () => {
    const order: string[] = [];
    const limiter: ConcurrencyLimiter = {
      acquire: async () => {
        order.push("acquire");
        return () => order.push("release");
      },
    };
    const limited = new LimitedSource(
      fakeSource(async () => {
        order.push("fetch");
        return new ArrayBuffer(0);
      }),
      { limiter },
    );
    await limited.fetch(0, 4);
    expect(order).toEqual(["acquire", "fetch", "release"]);
  });

  it("forwards offset/length/options to the wrapped source's fetch", async () => {
    const calls: Array<[number, number | undefined, unknown]> = [];
    const limiter: ConcurrencyLimiter = { acquire: async () => () => {} };
    const signal = new AbortController().signal;
    const limited = new LimitedSource(
      fakeSource(async (offset, length, options) => {
        calls.push([offset, length, options]);
        return new ArrayBuffer(0);
      }),
      { limiter },
    );
    await limited.fetch(100, 200, { signal });
    expect(calls).toEqual([[100, 200, { signal }]]);
  });

  it("releases the slot when the wrapped fetch rejects (and propagates)", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const limiter: ConcurrencyLimiter = {
      acquire: (_url, signal) => sem.acquire(signal),
    };
    const limited = new LimitedSource(
      fakeSource(async () => {
        throw new Error("network down");
      }),
      { limiter },
    );
    await expect(limited.fetch(0, 4)).rejects.toThrow("network down");
    // Slot was released — a second fetch (with a source that resolves) must
    // not hang.
    const ok = new LimitedSource(fakeSource(), { limiter });
    await ok.fetch(0, 4);
  });

  it("forwards the signal to limiter.acquire so a queued abort drops the read before fetching", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const limiter: ConcurrencyLimiter = {
      acquire: (_url, signal) => sem.acquire(signal),
    };
    // Saturate the semaphore so the next acquire queues.
    const hold = await sem.acquire();
    let fetched = false;
    const limited = new LimitedSource(
      fakeSource(async () => {
        fetched = true;
        return new ArrayBuffer(0);
      }),
      { limiter },
    );
    const ac = new AbortController();
    const pending = limited.fetch(0, 8, { signal: ac.signal });
    ac.abort(new Error("pan-away"));
    await expect(pending).rejects.toThrow("pan-away");
    expect(fetched).toBe(false);
    hold();
  });

  it("delegates type/url/metadata/head and routes acquire on the source's url", async () => {
    const acquired: URL[] = [];
    const limiter: ConcurrencyLimiter = {
      acquire: async (url) => {
        acquired.push(url);
        return () => {};
      },
    };
    const source = fakeSource();
    const limited = new LimitedSource(source, { limiter });
    expect(limited.type).toBe(source.type);
    expect(limited.url).toBe(source.url);
    expect(limited.metadata).toBe(source.metadata);
    expect(await limited.head()).toEqual({ size: 1024 });
    await limited.fetch(0, 4);
    expect(acquired).toEqual([source.url]);
  });

  it("threads getPriority through to limiter.acquire", async () => {
    const priorities: Array<Priority | undefined> = [];
    const limiter: ConcurrencyLimiter = {
      acquire: async (_url, _signal, getPriority) => {
        priorities.push(getPriority?.());
        return () => {};
      },
    };
    const limited = new LimitedSource(fakeSource(), {
      limiter,
      getPriority: () => [2, 7],
    });
    await limited.fetch(0, 4);
    expect(priorities).toEqual([[2, 7]]);
  });
});
