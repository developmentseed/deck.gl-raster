import { describe, expect, it } from "vitest";
import type { ConcurrencyLimiter, Priority } from "../src/limiter.js";
import { RangeStream } from "../src/stream.js";
import { fakeFetch, file, member, pattern } from "./helpers.js";

const MAX = 16 * 1024 * 1024;

describe("RangeStream", () => {
  describe("happy path", () => {
    it("resolves members in offset order as chunks arrive", async () => {
      const { fetch, next } = fakeFetch();
      const a = member(0, 10);
      const b = member(50, 20);
      const stream = new RangeStream(
        file(),
        { offset: 0, length: 100 },
        [a, b],
        {
          fetch,
          maxRequestBytes: MAX,
        },
      );
      const done = stream.run();
      const call = await next();
      expect(call.range).toBe("bytes=0-99");
      const body = call.reply({
        status: 206,
        headers: { "content-length": "100" },
      });
      await body.push(pattern(30));
      expect(await a.promise).toEqual({ kind: "bytes", bytes: pattern(10) });
      expect(stream.received).toBe(30);
      await body.push(pattern(70, 30));
      expect(await b.promise).toEqual({
        kind: "bytes",
        bytes: pattern(20, 50),
      });
      await body.close();
      const outcome = await done;
      expect(outcome).toMatchObject({ offset: 0, end: { kind: "complete" } });
      expect(outcome.bytes).toEqual(pattern(100));
      expect(stream.active).toBe(false);
    });

    it("merges init headers, sends the Range header and the cache mode", async () => {
      const { fetch, next } = fakeFetch();
      const stream = new RangeStream(
        file("https://x.test/a.tif", {
          headers: { authorization: "Bearer t" },
          credentials: "include",
        }),
        { offset: 10, length: 5 },
        [member(10, 5)],
        { fetch, maxRequestBytes: MAX, cacheMode: "no-store" },
      );
      void stream.run();
      const call = await next();
      expect(call.url).toBe("https://x.test/a.tif");
      expect(call.range).toBe("bytes=10-14");
      expect(new Headers(call.init.headers).get("authorization")).toBe(
        "Bearer t",
      );
      expect(call.init.credentials).toBe("include");
      expect(call.init.cache).toBe("no-store");
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
    });

    it("resolves an attached member when its bytes pass, at once when they already have", async () => {
      const { fetch, next } = fakeFetch();
      const a = member(0, 10);
      // Keeps the stream alive after `a` resolves, so `c` can attach.
      const d = member(95, 5);
      const stream = new RangeStream(
        file(),
        { offset: 0, length: 100 },
        [a, d],
        {
          fetch,
          maxRequestBytes: MAX,
        },
      );
      const done = stream.run();
      const body = (await next()).reply({
        status: 206,
        headers: { "content-length": "100" },
      });
      await body.push(pattern(30));

      const c = member(80, 10);
      expect(stream.attach(c)).toBe(true);
      const early = member(0, 5);
      expect(stream.attach(early)).toBe(true);
      expect(await early.promise).toEqual({ kind: "bytes", bytes: pattern(5) });
      expect(stream.attach(member(200, 1))).toBe(false);

      await body.push(pattern(70, 30));
      expect(await c.promise).toEqual({
        kind: "bytes",
        bytes: pattern(10, 80),
      });
      await body.close();
      await done;
      expect(await d.promise).toEqual({ kind: "bytes", bytes: pattern(5, 95) });
      expect(stream.attach(member(0, 1))).toBe(false);
    });

    it("sends no Range header for a whole-object request and resolves its member at the end", async () => {
      const { fetch, next } = fakeFetch();
      const whole = member(0, 0);
      const stream = new RangeStream(file(), undefined, [whole], {
        fetch,
        maxRequestBytes: MAX,
      });
      const done = stream.run();
      const call = await next();
      expect(call.range).toBeNull();
      expect(stream.range).toBeUndefined();
      const body = call.reply({
        status: 200,
        headers: { "content-length": "40" },
      });
      await body.push(pattern(40));
      await body.close();
      expect(await whole.promise).toEqual({
        kind: "bytes",
        bytes: pattern(40),
      });
      expect(await done).toMatchObject({
        offset: 0,
        end: { kind: "complete" },
      });
    });

    it("sends bytes=-N for a suffix request and places it only when Content-Range says where", async () => {
      const placed = fakeFetch();
      const a = member(0, 0);
      const stream = new RangeStream(file(), { suffixLength: 16 }, [a], {
        fetch: placed.fetch,
        maxRequestBytes: MAX,
      });
      const done = stream.run();
      const call = await placed.next();
      expect(call.range).toBe("bytes=-16");
      const body = call.reply({
        status: 206,
        headers: { "content-length": "16", "content-range": "bytes 84-99/100" },
      });
      await body.push(pattern(16, 84));
      await body.close();
      expect(await a.promise).toEqual({
        kind: "bytes",
        bytes: pattern(16, 84),
      });
      expect(await done).toMatchObject({ offset: 84, size: 100 });

      const unplaced = fakeFetch();
      const b = member(0, 0);
      const stream2 = new RangeStream(file(), { suffixLength: 16 }, [b], {
        fetch: unplaced.fetch,
        maxRequestBytes: MAX,
      });
      const done2 = stream2.run();
      const body2 = (await unplaced.next()).reply({
        status: 206,
        headers: { "content-length": "16" },
      });
      await body2.push(pattern(16));
      await body2.close();
      const outcome = await done2;
      expect(outcome.offset).toBeUndefined();
      expect(outcome.size).toBeUndefined();
      expect(outcome.bytes).toEqual(pattern(16));
    });
  });
});

interface AcquireCall {
  url: URL;
  signal?: AbortSignal;
  getPriority?: () => Priority;
}

/** A limiter stub that records acquires and grants them on demand. */
function fakeLimiter(grantAtOnce = true) {
  const acquires: AcquireCall[] = [];
  let released = 0;
  const release = () => {
    released += 1;
  };
  let grant: (() => void) | undefined;
  const limiter: ConcurrencyLimiter = {
    acquire(url, signal, getPriority) {
      acquires.push({ url, signal, getPriority });
      if (grantAtOnce) {
        return Promise.resolve(release);
      }
      return new Promise<() => void>((resolve, reject) => {
        grant = () => resolve(release);
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    },
  };
  return {
    limiter,
    acquires,
    get released() {
      return released;
    },
    grant: () => grant?.(),
  };
}

describe("RangeStream cancellation", () => {
  it("rejects an aborted member with its reason and keeps streaming for the others", async () => {
    const { fetch, next } = fakeFetch();
    const ac = new AbortController();
    const a = member(0, 10, { signal: ac.signal });
    const b = member(50, 20);
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a, b], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const call = await next();
    const body = call.reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    ac.abort("gone");
    await expect(a.promise).rejects.toBe("gone");
    await body.push(pattern(100));
    expect(await b.promise).toEqual({ kind: "bytes", bytes: pattern(20, 50) });
    expect(call.cancelled).toBe(false);
    await body.close();
    expect((await done).end).toEqual({ kind: "complete" });
  });

  it("cancels the request when its last live member leaves, keeping the prefix", async () => {
    const { fetch, next } = fakeFetch();
    const ac = new AbortController();
    const a = member(0, 50, { signal: ac.signal });
    const b = member(60, 20, { signal: ac.signal });
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a, b], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const call = await next();
    const body = call.reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(30));
    ac.abort("gone");
    const outcome = await done;
    expect(call.cancelled).toBe(true);
    expect(outcome.end).toEqual({ kind: "cancelled" });
    expect(outcome.bytes).toEqual(pattern(30));
    expect(stream.active).toBe(false);
  });

  it("does not keep a request alive for members that already resolved", async () => {
    const { fetch, next } = fakeFetch();
    const ac = new AbortController();
    const a = member(0, 10);
    const b = member(90, 10, { signal: ac.signal });
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a, b], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const call = await next();
    const body = call.reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(20));
    expect(await a.promise).toEqual({ kind: "bytes", bytes: pattern(10) });
    ac.abort("gone");
    expect((await done).end).toEqual({ kind: "cancelled" });
    expect(call.cancelled).toBe(true);
  });

  it("keeps a request alive for an attached member after the originals leave", async () => {
    const { fetch, next } = fakeFetch();
    const ac = new AbortController();
    const a = member(0, 10, { signal: ac.signal });
    const b = member(90, 10, { signal: ac.signal });
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a, b], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const call = await next();
    const body = call.reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(20));
    const c = member(60, 10);
    expect(stream.attach(c)).toBe(true);
    ac.abort("gone");
    expect(call.cancelled).toBe(false);
    await body.push(pattern(80, 20));
    expect(await c.promise).toEqual({ kind: "bytes", bytes: pattern(10, 60) });
    await body.close();
    expect((await done).end).toEqual({ kind: "complete" });
  });

  it("rejects a member that is already aborted and does not count it", async () => {
    const { fetch, next } = fakeFetch();
    const ac = new AbortController();
    ac.abort("early");
    const a = member(0, 10, { signal: ac.signal });
    const b = member(50, 20);
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a, b], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    await expect(a.promise).rejects.toBe("early");
    const call = await next();
    const body = call.reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(100));
    await body.close();
    expect(await b.promise).toEqual({ kind: "bytes", bytes: pattern(20, 50) });
    expect((await done).end).toEqual({ kind: "complete" });
  });

  it("takes one limiter slot with the best member priority and releases it when done", async () => {
    const { fetch, next, calls } = fakeFetch();
    const limiter = fakeLimiter(false);
    const ac = new AbortController();
    const a = member(0, 10, { getPriority: () => 5 });
    const b = member(50, 20, { getPriority: () => 2, signal: ac.signal });
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a, b], {
      fetch,
      maxRequestBytes: MAX,
      limiter: limiter.limiter,
    });
    const done = stream.run();
    await Promise.resolve();
    expect(limiter.acquires).toHaveLength(1);
    expect(calls).toHaveLength(0);
    const acquire = limiter.acquires[0]!;
    expect(acquire.url.href).toBe("https://x.test/a.tif");
    expect(acquire.getPriority?.()).toBe(2);
    ac.abort("gone");
    expect(acquire.getPriority?.()).toBe(5);
    limiter.grant();
    const call = await next();
    expect(limiter.released).toBe(0);
    const body = call.reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(100));
    await body.close();
    await done;
    expect(limiter.released).toBe(1);
  });

  it("gives up the slot wait when every member leaves first", async () => {
    const { fetch, calls } = fakeFetch();
    const limiter = fakeLimiter(false);
    const ac = new AbortController();
    const a = member(0, 10, { signal: ac.signal });
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a], {
      fetch,
      maxRequestBytes: MAX,
      limiter: limiter.limiter,
    });
    const done = stream.run();
    await Promise.resolve();
    ac.abort("gone");
    const outcome = await done;
    expect(outcome.end).toEqual({ kind: "cancelled" });
    expect(limiter.acquires[0]?.signal?.aborted).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("makes no limiter call when limiter is null or omitted", async () => {
    for (const limiter of [null, undefined]) {
      const { fetch, next } = fakeFetch();
      const a = member(0, 10);
      const stream = new RangeStream(file(), { offset: 0, length: 10 }, [a], {
        fetch,
        maxRequestBytes: MAX,
        limiter,
      });
      void stream.run();
      expect((await next()).range).toBe("bytes=0-9");
    }
  });
});

describe("RangeStream responses", () => {
  it("resolves the remaining members short when the object ends early and reports the size", async () => {
    const { fetch, next } = fakeFetch();
    const a = member(0, 10);
    const b = member(50, 20);
    const c = member(90, 10);
    const stream = new RangeStream(
      file(),
      { offset: 0, length: 100 },
      [a, b, c],
      {
        fetch,
        maxRequestBytes: MAX,
      },
    );
    const done = stream.run();
    const body = (await next()).reply({
      status: 206,
      headers: { "content-length": "60" },
    });
    await body.push(pattern(60));
    await body.close();
    expect(await a.promise).toEqual({ kind: "bytes", bytes: pattern(10) });
    expect(await b.promise).toEqual({ kind: "bytes", bytes: pattern(10, 50) });
    expect(await c.promise).toEqual({
      kind: "bytes",
      bytes: new Uint8Array(0),
    });
    const outcome = await done;
    expect(outcome.end).toEqual({ kind: "eof", size: 60 });
    expect(outcome.size).toBe(60);
    expect(outcome.bytes).toEqual(pattern(60));
  });

  it("rejects the remaining members on a truncated transfer and keeps the prefix", async () => {
    const { fetch, next } = fakeFetch();
    const a = member(0, 10);
    const b = member(50, 20);
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a, b], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const body = (await next()).reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(30));
    await body.close();
    expect(await a.promise).toEqual({ kind: "bytes", bytes: pattern(10) });
    await expect(b.promise).rejects.toThrow(
      /Short read from https:\/\/x\.test\/a\.tif: wanted 100 bytes at 0, got 30/,
    );
    const outcome = await done;
    expect(outcome.end).toEqual({ kind: "truncated" });
    expect(outcome.bytes).toEqual(pattern(30));
  });

  it("treats a clean early end without Content-Length as the end of the object", async () => {
    const { fetch, next } = fakeFetch();
    const a = member(50, 20);
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const body = (await next()).reply({ status: 206 });
    await body.push(pattern(30));
    await body.close();
    expect(await a.promise).toEqual({
      kind: "bytes",
      bytes: new Uint8Array(0),
    });
    expect((await done).end).toEqual({ kind: "eof", size: 30 });
  });

  it("consumes a 200 with a small Content-Length as the whole object", async () => {
    const { fetch, next } = fakeFetch();
    const a = member(120, 10);
    const stream = new RangeStream(file(), { offset: 100, length: 50 }, [a], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const body = (await next()).reply({
      status: 200,
      headers: { "content-length": "300" },
    });
    await body.push(pattern(300));
    await body.close();
    expect(await a.promise).toEqual({ kind: "bytes", bytes: pattern(10, 120) });
    const outcome = await done;
    expect(outcome.offset).toBe(0);
    expect(outcome.bytes).toHaveLength(300);
    expect(outcome.end).toEqual({ kind: "complete" });
  });

  it("rejects a 200 without a usable Content-Length", async () => {
    for (const headers of [
      undefined,
      { "content-length": String(17 * 1024 * 1024) },
    ]) {
      const { fetch, next } = fakeFetch();
      const a = member(120, 10);
      const stream = new RangeStream(file(), { offset: 100, length: 50 }, [a], {
        fetch,
        maxRequestBytes: MAX,
      });
      const done = stream.run();
      const call = await next();
      call.reply({ status: 200, headers });
      await expect(a.promise).rejects.toThrow(/answered 200/);
      expect((await done).end.kind).toBe("failed");
      expect(call.cancelled).toBe(true);
    }
  });

  it("resolves every member not-found on 404", async () => {
    const { fetch, next } = fakeFetch();
    const a = member(0, 10);
    const b = member(50, 20);
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a, b], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    (await next()).reply({ status: 404 });
    expect(await a.promise).toEqual({ kind: "not-found" });
    expect(await b.promise).toEqual({ kind: "not-found" });
    const outcome = await done;
    expect(outcome.end).toEqual({ kind: "not-found" });
    expect(outcome.bytes).toHaveLength(0);
  });

  it("rejects every member on 416 and 500 with the status", async () => {
    for (const status of [416, 500]) {
      const { fetch, next } = fakeFetch();
      const a = member(0, 10);
      const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a], {
        fetch,
        maxRequestBytes: MAX,
      });
      const done = stream.run();
      (await next()).reply({ status });
      await expect(a.promise).rejects.toThrow(new RegExp(`answered ${status}`));
      expect((await done).end.kind).toBe("failed");
    }
  });

  it("records the object size from Content-Range", async () => {
    const { fetch, next } = fakeFetch();
    const a = member(0, 10);
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const body = (await next()).reply({
      status: 206,
      headers: { "content-length": "100", "content-range": "bytes 0-99/5000" },
    });
    await body.push(pattern(100));
    await body.close();
    expect((await done).size).toBe(5000);
  });

  it("copies only the requested length when the body sends more, then cancels", async () => {
    const { fetch, next } = fakeFetch();
    const a = member(90, 10);
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const call = await next();
    const body = call.reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(150));
    expect(await a.promise).toEqual({ kind: "bytes", bytes: pattern(10, 90) });
    const outcome = await done;
    expect(call.cancelled).toBe(true);
    expect(outcome.end).toEqual({ kind: "complete" });
    expect(outcome.bytes).toHaveLength(100);
  });

  it("rejects live members when fetch rejects or throws", async () => {
    const rejecting = (() => Promise.reject(new Error("net"))) as typeof fetch;
    const a = member(0, 10);
    const outcome = await new RangeStream(
      file(),
      { offset: 0, length: 100 },
      [a],
      {
        fetch: rejecting,
        maxRequestBytes: MAX,
      },
    ).run();
    await expect(a.promise).rejects.toThrow("net");
    expect(outcome.end.kind).toBe("failed");

    const throwing = (() => {
      throw new Error("sync");
    }) as typeof fetch;
    const b = member(0, 10);
    const outcome2 = await new RangeStream(
      file(),
      { offset: 0, length: 100 },
      [b],
      {
        fetch: throwing,
        maxRequestBytes: MAX,
      },
    ).run();
    await expect(b.promise).rejects.toThrow("sync");
    expect(outcome2.end.kind).toBe("failed");
  });
});

describe("RangeStream under real-fetch failure modes", () => {
  it("rejects the unresolved members when the body errors mid-way and keeps the prefix", async () => {
    const { fetch, next } = fakeFetch();
    const a = member(0, 10);
    const b = member(50, 20);
    const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a, b], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const body = (await next()).reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(30));
    expect(await a.promise).toEqual({ kind: "bytes", bytes: pattern(10) });
    await body.error(new Error("net"));
    await expect(b.promise).rejects.toThrow("net");
    const outcome = await done;
    expect(outcome.end).toMatchObject({ kind: "failed" });
    expect(outcome.bytes).toEqual(pattern(30));
    expect(stream.active).toBe(false);
  });

  it("does not pin the whole preallocated buffer for a cancelled prefix", async () => {
    const { fetch, next } = fakeFetch();
    const ac = new AbortController();
    const a = member(0, 100, { signal: ac.signal });
    const stream = new RangeStream(file(), { offset: 0, length: MAX }, [a], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const body = (await next()).reply({
      status: 206,
      headers: { "content-length": String(MAX) },
    });
    await body.push(pattern(30));
    ac.abort("gone");
    const outcome = await done;
    expect(outcome.end).toEqual({ kind: "cancelled" });
    expect(outcome.bytes).toEqual(pattern(30));
    expect(outcome.bytes.buffer.byteLength).toBe(30);
  });

  it("cancels once the last live member resolves while bytes remain", async () => {
    const { fetch, next } = fakeFetch();
    const ac = new AbortController();
    const a = member(0, 100);
    const b = member(100, 100, { signal: ac.signal });
    const stream = new RangeStream(file(), { offset: 0, length: 200 }, [a, b], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const call = await next();
    const body = call.reply({
      status: 206,
      headers: { "content-length": "200" },
    });
    ac.abort("gone");
    await expect(b.promise).rejects.toBe("gone");
    await body.push(pattern(100));
    expect(await a.promise).toEqual({ kind: "bytes", bytes: pattern(100) });
    const outcome = await done;
    expect(call.cancelled).toBe(true);
    expect(outcome.end).toEqual({ kind: "cancelled" });
    expect(outcome.bytes).toEqual(pattern(100));
  });

  it("serves a suffix read from a 200 whole-object answer", async () => {
    const { fetch, next } = fakeFetch();
    const a = member(0, 0);
    const stream = new RangeStream(file(), { suffixLength: 16 }, [a], {
      fetch,
      maxRequestBytes: MAX,
    });
    const done = stream.run();
    const body = (await next()).reply({
      status: 200,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(100));
    await body.close();
    expect(await a.promise).toEqual({ kind: "bytes", bytes: pattern(16, 84) });
    const outcome = await done;
    expect(outcome.offset).toBe(0);
    expect(outcome.bytes).toHaveLength(100);
  });
});
