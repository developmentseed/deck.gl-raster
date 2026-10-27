import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConcurrencyLimiter } from "../src/limiter.js";
import { RangeReader } from "../src/reader.js";
import type { ByteCache } from "../src/types.js";
import type { FakeFetch } from "./helpers.js";
import { fakeFetch, file, pattern } from "./helpers.js";

const f = file();
const DATA = { purpose: "data" } as const;
const METADATA = { purpose: "metadata" } as const;

/** Run the reader's task window. */
const flush = () => vi.advanceTimersByTimeAsync(0);

/** Let promise chains settle without advancing timers. */
async function microtasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe("RangeReader", () => {
  let fake: FakeFetch;
  let reader: RangeReader;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    fake = fakeFetch();
    reader = new RangeReader({ fetch: fake.fetch, maxGap: 100 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges reads issued in one task into one request", async () => {
    const p1 = reader.read(f, { offset: 0, length: 100 }, DATA);
    const p2 = reader.read(f, { offset: 100, length: 100 }, DATA);
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.range).toBe("bytes=0-199");
    const body = fake.calls[0]!.reply({
      status: 206,
      headers: { "content-length": "200" },
    });
    await body.push(pattern(200));
    await body.close();
    expect(await p1).toEqual({ kind: "bytes", bytes: pattern(100) });
    expect(await p2).toEqual({ kind: "bytes", bytes: pattern(100, 100) });
  });

  it("sends reads issued in different tasks separately", async () => {
    void reader.read(f, { offset: 0, length: 10 }, DATA);
    await flush();
    void reader.read(f, { offset: 5000, length: 10 }, DATA);
    await flush();
    expect(fake.calls.map((c) => c.range)).toEqual([
      "bytes=0-9",
      "bytes=5000-5009",
    ]);
  });

  it("merges two identical reads into one request and resolves both", async () => {
    const p1 = reader.read(f, { offset: 0, length: 100 }, DATA);
    const p2 = reader.read(f, { offset: 0, length: 100 }, DATA);
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.range).toBe("bytes=0-99");
    const body = fake.calls[0]!.reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(100));
    await body.close();
    expect(await p1).toEqual({ kind: "bytes", bytes: pattern(100) });
    expect(await p2).toEqual({ kind: "bytes", bytes: pattern(100) });
  });

  it("rejects a read aborted before the flush and leaves it out of the request", async () => {
    const ac = new AbortController();
    void reader.read(f, { offset: 0, length: 100 }, DATA);
    const b = reader.read(
      f,
      { offset: 200, length: 100 },
      {
        ...DATA,
        signal: ac.signal,
      },
    );
    ac.abort("gone");
    await expect(b).rejects.toBe("gone");
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.range).toBe("bytes=0-99");
  });

  it("widens small metadata reads to aligned blocks and merges them", async () => {
    // Widened to [64, 128) and [192, 256): one request only if the 64-byte
    // gap between the blocks may be merged across.
    const reader = new RangeReader({
      fetch: fake.fetch,
      maxGap: 64,
      minMetadataReadBytes: 64,
    });
    const p1 = reader.read(f, { offset: 100, length: 8 }, METADATA);
    const p2 = reader.read(f, { offset: 200, length: 8 }, METADATA);
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.range).toBe("bytes=64-255");
    const body = fake.calls[0]!.reply({
      status: 206,
      headers: { "content-length": "192" },
    });
    await body.push(pattern(192, 64));
    await body.close();
    expect(await p1).toEqual({ kind: "bytes", bytes: pattern(8, 100) });
    expect(await p2).toEqual({ kind: "bytes", bytes: pattern(8, 200) });
  });

  it("keeps a widened block streaming after its small read resolves and caches it whole", async () => {
    // The body arrives in two chunks: the small read resolves on the first,
    // and the block must stay wanted until the second lands in the cache.
    const reader = new RangeReader({
      fetch: fake.fetch,
      minMetadataReadBytes: 64,
    });
    const p = reader.read(f, { offset: 4, length: 8 }, METADATA);
    await flush();
    expect(fake.calls[0]!.range).toBe("bytes=0-63");
    const body = fake.calls[0]!.reply({
      status: 206,
      headers: { "content-length": "64" },
    });
    await body.push(pattern(16));
    expect(await p).toEqual({ kind: "bytes", bytes: pattern(8, 4) });
    expect(fake.calls[0]!.cancelled).toBe(false);
    await body.push(pattern(48, 16));
    await body.close();
    await microtasks();
    const later = await reader.read(f, { offset: 40, length: 8 }, METADATA);
    expect(later).toEqual({ kind: "bytes", bytes: pattern(8, 40) });
    expect(fake.calls).toHaveLength(1);
    expect(reader.stats.cancelled).toBe(0);
  });

  it("attaches a data read to an in-flight metadata block instead of requesting", async () => {
    // The top overview tile often sits inside the first metadata block and is
    // asked for as soon as its offset entry resolves, early in that stream.
    const reader = new RangeReader({
      fetch: fake.fetch,
      minMetadataReadBytes: 64,
    });
    const h = reader.read(f, { offset: 4, length: 8 }, METADATA);
    await flush();
    const body = fake.calls[0]!.reply({
      status: 206,
      headers: { "content-length": "64" },
    });
    await body.push(pattern(16));
    expect(await h).toEqual({ kind: "bytes", bytes: pattern(8, 4) });
    const d = reader.read(f, { offset: 40, length: 8 }, DATA);
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(reader.stats.attached).toBe(1);
    await body.push(pattern(48, 16));
    await body.close();
    expect(await d).toEqual({ kind: "bytes", bytes: pattern(8, 40) });
  });

  it("treats a read without a purpose as data: not widened", async () => {
    const reader = new RangeReader({
      fetch: fake.fetch,
      minMetadataReadBytes: 64,
    });
    void reader.read(f, { offset: 4, length: 8 }, {});
    await flush();
    expect(fake.calls[0]!.range).toBe("bytes=4-11");
  });

  it("never shares a request between metadata and data reads of one file", async () => {
    void reader.read(f, { offset: 0, length: 10 }, METADATA);
    void reader.read(f, { offset: 10, length: 10 }, DATA);
    await flush();
    expect(fake.calls).toHaveLength(2);
  });

  it("never shares a request between different request inits of one URL", async () => {
    void reader.read(f, { offset: 0, length: 10 }, DATA);
    void reader.read(
      file("https://x.test/a.tif", { credentials: "include" }),
      { offset: 10, length: 10 },
      DATA,
    );
    await flush();
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.init.credentials).toBe("include");
  });

  it("sends suffix and whole-object reads at once, unmerged", async () => {
    void reader.read(f, undefined, DATA);
    void reader.read(f, { suffixLength: 8 }, DATA);
    await microtasks();
    expect(fake.calls.map((c) => c.range)).toEqual([null, "bytes=-8"]);
  });

  it("resolves a zero-length read without a request", async () => {
    expect(await reader.read(f, { offset: 5, length: 0 }, DATA)).toEqual({
      kind: "bytes",
      bytes: new Uint8Array(0),
    });
    await flush();
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects a read whose signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort("early");
    await expect(
      reader.read(f, { offset: 0, length: 10 }, { ...DATA, signal: ac.signal }),
    ).rejects.toBe("early");
    await flush();
    expect(fake.calls).toHaveLength(0);
  });

  it("counts requests, bytes and over-fetch", async () => {
    const p1 = reader.read(f, { offset: 0, length: 10 }, DATA);
    const p2 = reader.read(f, { offset: 20, length: 10 }, DATA);
    await flush();
    expect(reader.stats).toMatchObject({
      requests: 1,
      bytesRequested: 30,
      bytesOverfetched: 10,
      bytesReceived: 0,
    });
    const body = fake.calls[0]!.reply({
      status: 206,
      headers: { "content-length": "30" },
    });
    await body.push(pattern(30));
    await body.close();
    await Promise.all([p1, p2]);
    await microtasks();
    expect(reader.stats.bytesReceived).toBe(30);
  });

  it("passes the reads' limiter to the stream", async () => {
    let acquires = 0;
    const limiter: ConcurrencyLimiter = {
      acquire() {
        acquires += 1;
        return Promise.resolve(() => {});
      },
    };
    void reader.read(f, { offset: 0, length: 10 }, { ...DATA, limiter });
    void reader.read(f, { offset: 20, length: 10 }, { ...DATA, limiter });
    await flush();
    await microtasks();
    expect(acquires).toBe(1);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("RangeReader cache and in-flight reads", () => {
  let fake: FakeFetch;
  let reader: RangeReader;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    fake = fakeFetch();
    reader = new RangeReader({ fetch: fake.fetch, maxGap: 100 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Complete one read of `[0, length)` so its bytes are cached. */
  async function prime(length: number, contentLength = length) {
    const p = reader.read(f, { offset: 0, length }, DATA);
    await flush();
    const body = fake.calls[fake.calls.length - 1]!.reply({
      status: 206,
      headers: { "content-length": String(contentLength) },
    });
    await body.push(pattern(contentLength));
    await body.close();
    await p;
    await microtasks();
  }

  it("serves a repeat read from the cache without a request", async () => {
    await prime(100);
    const hit = await reader.read(f, { offset: 10, length: 10 }, DATA);
    expect(hit).toEqual({ kind: "bytes", bytes: pattern(10, 10) });
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(reader.stats.cacheHits).toBe(1);
    expect(reader.stats.cacheHitBytes).toBe(10);
  });

  it("attaches a read inside an in-flight request instead of requesting", async () => {
    void reader.read(f, { offset: 0, length: 100 }, DATA);
    await flush();
    const body = fake.calls[0]!.reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(20));
    const p2 = reader.read(f, { offset: 50, length: 10 }, DATA);
    await flush();
    expect(fake.calls).toHaveLength(1);
    await body.push(pattern(80, 20));
    expect(await p2).toEqual({ kind: "bytes", bytes: pattern(10, 50) });
    expect(reader.stats.attached).toBe(1);
  });

  it("caches the received prefix of a cancelled request", async () => {
    const ac = new AbortController();
    const a = reader.read(f, { offset: 0, length: 100 }, DATA);
    const b = reader.read(
      f,
      { offset: 100, length: 100 },
      {
        ...DATA,
        signal: ac.signal,
      },
    );
    await flush();
    expect(fake.calls).toHaveLength(1);
    const body = fake.calls[0]!.reply({
      status: 206,
      headers: { "content-length": "200" },
    });
    await body.push(pattern(100));
    await a;
    ac.abort("gone");
    await expect(b).rejects.toBe("gone");
    await microtasks();
    expect(fake.calls[0]!.cancelled).toBe(true);
    expect(reader.stats.cancelled).toBe(1);
    const hit = await reader.read(f, { offset: 10, length: 10 }, DATA);
    expect(hit).toEqual({ kind: "bytes", bytes: pattern(10, 10) });
    await flush();
    expect(fake.calls).toHaveLength(1);
  });

  it("resolves a read at or past a known object size without a request", async () => {
    await prime(100, 60);
    expect(await reader.read(f, { offset: 70, length: 10 }, DATA)).toEqual({
      kind: "bytes",
      bytes: new Uint8Array(0),
    });
    await flush();
    expect(fake.calls).toHaveLength(1);
    void reader.read(f, { offset: 50, length: 20 }, DATA);
    await flush();
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.range).toBe("bytes=50-69");
  });

  it("uses a supplied cache", async () => {
    const puts: Array<[number, number, string]> = [];
    const cache: ByteCache = {
      get: (_file, range) =>
        Promise.resolve(range.offset === 0 ? pattern(10) : undefined),
      put: (_file, offset, bytes, purpose) => {
        puts.push([offset, bytes.length, purpose]);
        return Promise.resolve();
      },
    };
    const reader = new RangeReader({ fetch: fake.fetch, cache });
    expect(await reader.read(f, { offset: 0, length: 10 }, DATA)).toEqual({
      kind: "bytes",
      bytes: pattern(10),
    });
    await flush();
    expect(fake.calls).toHaveLength(0);
    const p = reader.read(f, { offset: 500, length: 10 }, DATA);
    await flush();
    const body = fake.calls[0]!.reply({
      status: 206,
      headers: { "content-length": "10" },
    });
    await body.push(pattern(10));
    await body.close();
    await p;
    await microtasks();
    expect(puts).toEqual([[500, 10, "data"]]);
  });

  it("rejects a read whose signal aborts during the cache lookup and never queues it", async () => {
    let release!: () => void;
    const cache: ByteCache = {
      get: () =>
        new Promise((resolve) => {
          release = () => resolve(undefined);
        }),
      put: () => Promise.resolve(),
    };
    const reader = new RangeReader({ fetch: fake.fetch, cache });
    const ac = new AbortController();
    const p = reader.read(
      f,
      { offset: 0, length: 10 },
      {
        ...DATA,
        signal: ac.signal,
      },
    );
    await microtasks();
    ac.abort("gone");
    release();
    await expect(p).rejects.toBe("gone");
    await flush();
    expect(fake.calls).toHaveLength(0);
  });

  it("does not cache a not-found response", async () => {
    const p = reader.read(f, { offset: 0, length: 10 }, DATA);
    await flush();
    fake.calls[0]!.reply({ status: 404 });
    expect(await p).toEqual({ kind: "not-found" });
    await microtasks();
    void reader.read(f, { offset: 0, length: 10 }, DATA);
    await flush();
    expect(fake.calls).toHaveLength(2);
  });
});

describe("RangeReader after a request fails mid-body", () => {
  let fake: FakeFetch;
  let reader: RangeReader;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    fake = fakeFetch();
    reader = new RangeReader({ fetch: fake.fetch, maxGap: 100 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects the read, caches the prefix, and requests again afterwards", async () => {
    const p = reader.read(f, { offset: 0, length: 100 }, DATA);
    await flush();
    const body = fake.calls[0]!.reply({
      status: 206,
      headers: { "content-length": "100" },
    });
    await body.push(pattern(30));
    // Attach the handler before the rejection lands, as a caller would.
    const rejection = expect(p).rejects.toThrow("net");
    await body.error(new Error("net"));
    await rejection;
    await microtasks();
    expect(reader.stats.bytesReceived).toBe(30);
    expect(await reader.read(f, { offset: 10, length: 10 }, DATA)).toEqual({
      kind: "bytes",
      bytes: pattern(10, 10),
    });
    void reader.read(f, { offset: 0, length: 100 }, DATA);
    await flush();
    expect(fake.calls).toHaveLength(2);
  });
});
