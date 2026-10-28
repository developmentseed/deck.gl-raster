import type {
  ConcurrencyLimiter,
  Priority,
} from "@developmentseed/range-reader";
import { RangeReader } from "@developmentseed/range-reader";
import { describe, expect, it } from "vitest";
import { ByteSource } from "../src/byte-source.js";
import { fixtureServer } from "./utils/fixture-server.js";

const URL_A = new URL("https://x.test/a.tif");

/** `n` bytes whose value at index `i` is `(seed + i) & 0xff`. */
function pattern(n: number, seed = 0): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (seed + i) & 0xff;
  }
  return out;
}

function open(file = pattern(256), purpose: "metadata" | "data" = "data") {
  const server = fixtureServer(file);
  const reader = new RangeReader({ fetch: server.fetch });
  const source = new ByteSource({ reader, url: URL_A, purpose });
  return { server, reader, source };
}

describe("ByteSource", () => {
  it("reads an absolute range into a fresh ArrayBuffer", async () => {
    const { source } = open();
    const bytes = await source.fetch(100, 10);
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(bytes.byteLength).toBe(10);
    expect(new Uint8Array(bytes)).toEqual(pattern(10, 100));
  });

  it("sends negative offsets as suffix reads and offset 0 without a length as the whole object", async () => {
    const { source, server } = open();
    const tail = await source.fetch(-16);
    expect(tail.byteLength).toBe(16);
    expect(new Uint8Array(tail)).toEqual(pattern(16, 240));
    const whole = await source.fetch(0);
    expect(whole.byteLength).toBe(256);
    expect(server.requests).toEqual(["bytes=-16", ""]);
  });

  it("rejects an open-ended read from a positive offset", async () => {
    const { source } = open();
    await expect(source.fetch(10)).rejects.toThrow(
      "open-ended reads are not supported",
    );
  });

  it("throws for a missing object", async () => {
    const { source, server } = open();
    server.failNext(404);
    await expect(source.fetch(0, 10)).rejects.toThrow(
      "https://x.test/a.tif not found",
    );
  });

  it("keeps an infinite size whatever the server says", async () => {
    const { source } = open();
    const short = await source.fetch(200, 100);
    expect(short.byteLength).toBe(56);
    expect(source.metadata.size).toBe(Number.POSITIVE_INFINITY);
  });

  it("passes purpose, limiter, priority and init through to the reader", async () => {
    const server = fixtureServer(pattern(256));
    const reader = new RangeReader({ fetch: server.fetch });
    // The stream's priority is the best among its live reads, so it is read
    // here, while the read is live, not after it resolved.
    const acquires: Array<{ url: URL; priority: Priority | undefined }> = [];
    const limiter: ConcurrencyLimiter = {
      acquire(url, _signal, getPriority) {
        acquires.push({ url, priority: getPriority?.() });
        return Promise.resolve(() => {});
      },
    };
    const source = new ByteSource({
      reader,
      url: URL_A,
      purpose: "metadata",
      init: { headers: { authorization: "Bearer t" } },
      limiter,
      getPriority: () => 7,
    });
    const bytes = await source.fetch(100, 8);
    expect(new Uint8Array(bytes)).toEqual(pattern(8, 100));
    // A metadata read is widened to its 64 KiB block.
    expect(server.requests).toEqual(["bytes=0-65535"]);
    expect(server.headers[0]!.get("authorization")).toBe("Bearer t");
    expect(acquires).toHaveLength(1);
    expect(acquires[0]!.url.href).toBe(URL_A.href);
    expect(acquires[0]!.priority).toBe(7);
  });

  it("fails a read whose validator differs from the first it saw, as chunkd did", async () => {
    const server = fixtureServer(pattern(256), { etag: '"v1"' });
    const reader = new RangeReader({ fetch: server.fetch });
    const source = new ByteSource({
      reader,
      url: URL_A,
      purpose: "data",
    });
    await source.fetch(0, 10);
    // The object was replaced underneath the open file.
    server.etag = '"v2"';
    await expect(source.fetch(100, 10)).rejects.toThrow(
      'ETag conflict for https://x.test/a.tif: it was "v1" when opened, now "v2"',
    );
    // The reader adopted the new version: a fresh source over it works, and
    // the stale one keeps failing even on a cache hit.
    const fresh = new ByteSource({
      reader,
      url: URL_A,
      purpose: "data",
    });
    expect(new Uint8Array(await fresh.fetch(100, 10))).toEqual(
      pattern(10, 100),
    );
    await expect(source.fetch(100, 10)).rejects.toThrow("ETag conflict");
    expect(reader.stats.validatorChanges).toBe(1);
  });

  it("rejects with the signal's reason when the read is aborted", async () => {
    const { source, server } = open();
    const held = server.holdNext();
    const ac = new AbortController();
    const read = source.fetch(0, 10, { signal: ac.signal });
    await held.arrived;
    ac.abort("gone");
    await expect(read).rejects.toBe("gone");
    held.release();
  });
});
