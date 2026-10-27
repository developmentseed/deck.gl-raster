import type { SourceCallback, SourceRequest } from "@chunkd/source";
import type {
  ConcurrencyLimiter,
  Priority,
} from "@developmentseed/range-reader";
import { Semaphore } from "@developmentseed/range-reader";
import { describe, expect, it } from "vitest";
import { LimiterMiddleware } from "../src/limiter.js";

describe("LimiterMiddleware", () => {
  const URL_A = new URL("https://a.example.com/cog.tif");
  const REQ: SourceRequest = {
    source: {} as never,
    offset: 0,
    length: 4,
  };

  it("only invokes `next` after acquiring a slot, and releases after", async () => {
    const order: string[] = [];
    const limiter: ConcurrencyLimiter = {
      acquire: async () => {
        order.push("acquire");
        return () => order.push("release");
      },
    };
    const mw = new LimiterMiddleware({ url: URL_A, limiter });
    const next: SourceCallback = async () => {
      order.push("next");
      return new ArrayBuffer(0);
    };
    await mw.fetch(REQ, next);
    expect(order).toEqual(["acquire", "next", "release"]);
  });

  it("forwards req to `next` unchanged", async () => {
    const calls: SourceRequest[] = [];
    const limiter: ConcurrencyLimiter = {
      acquire: async () => () => {},
    };
    const mw = new LimiterMiddleware({ url: URL_A, limiter });
    const signal = new AbortController().signal;
    const req: SourceRequest = {
      source: {} as never,
      offset: 100,
      length: 200,
      signal,
    };
    const next: SourceCallback = async (r) => {
      calls.push(r);
      return new ArrayBuffer(0);
    };
    await mw.fetch(req, next);
    expect(calls).toEqual([req]);
  });

  it("releases the slot when `next` rejects (and propagates the error)", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const limiter: ConcurrencyLimiter = {
      acquire: (_url, signal) => sem.acquire(signal),
    };
    const mw = new LimiterMiddleware({ url: URL_A, limiter });
    await expect(
      mw.fetch(REQ, async () => {
        throw new Error("network down");
      }),
    ).rejects.toThrow("network down");
    // Slot was released — a second fetch must not hang.
    await mw.fetch(REQ, async () => new ArrayBuffer(0));
  });

  it("forwards req.signal to limiter.acquire so a queued abort drops the call", async () => {
    const sem = new Semaphore({ maxRequests: 1 });
    const limiter: ConcurrencyLimiter = {
      acquire: (_url, signal) => sem.acquire(signal),
    };
    // Saturate the semaphore so the next acquire queues.
    const hold = await sem.acquire();
    let nextCalled = false;
    const mw = new LimiterMiddleware({ url: URL_A, limiter });
    const ac = new AbortController();
    const req: SourceRequest = {
      source: {} as never,
      offset: 0,
      length: 8,
      signal: ac.signal,
    };
    const pending = mw.fetch(req, async () => {
      nextCalled = true;
      return new ArrayBuffer(0);
    });
    ac.abort(new Error("pan-away"));
    await expect(pending).rejects.toThrow("pan-away");
    expect(nextCalled).toBe(false);
    hold();
  });

  it("has the expected SourceMiddleware shape (name + fetch)", () => {
    const mw = new LimiterMiddleware({
      url: URL_A,
      limiter: { acquire: async () => () => {} },
    });
    expect(mw.name).toBe("limiter");
    expect(typeof mw.fetch).toBe("function");
  });

  it("threads getPriority from constructor through to limiter.acquire", async () => {
    const calls: Array<{
      url: URL;
      signal?: AbortSignal;
      priority: Priority | undefined;
    }> = [];
    const limiter: ConcurrencyLimiter = {
      acquire: async (url, signal, getPriority) => {
        calls.push({ url, signal, priority: getPriority?.() });
        return () => {};
      },
    };
    const mw = new LimiterMiddleware({
      url: URL_A,
      limiter,
      getPriority: () => [2, 7],
    });
    await mw.fetch(REQ, async () => new ArrayBuffer(0));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.priority).toEqual([2, 7]);
  });
});
