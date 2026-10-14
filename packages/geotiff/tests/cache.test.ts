import type { Source } from "@chunkd/source";
import { SourceView } from "@chunkd/source";
import { describe, expect, it } from "vitest";
import { CacheMiddleware } from "../src/cache.js";

/** A read the test settles by hand. */
interface PendingRead {
  offset: number;
  resolve(bytes: ArrayBuffer): void;
  reject(error: unknown): void;
}

/** A source whose reads stay pending until the test settles them. */
function manualSource(): { source: Source; reads: PendingRead[] } {
  const reads: PendingRead[] = [];
  const source: Source = {
    type: "memory",
    url: new URL("memory://test.tif"),
    head: async () => ({ size: 1024 }),
    fetch: (offset) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        reads.push({ offset, resolve, reject });
      }),
  };
  return { source, reads };
}

describe("CacheMiddleware", () => {
  it("shares one read among concurrent and later reads of a range", async () => {
    const { source, reads } = manualSource();
    const view = new SourceView(source, [new CacheMiddleware({ size: 1024 })]);
    const bytes = new ArrayBuffer(100);

    const first = view.fetch(0, 100);
    const concurrent = view.fetch(0, 100);
    reads[0]!.resolve(bytes);
    await expect(first).resolves.toBe(bytes);
    await expect(concurrent).resolves.toBe(bytes);
    await expect(view.fetch(0, 100)).resolves.toBe(bytes);

    expect(reads).toHaveLength(1);
  });

  it("retries a range whose read failed", async () => {
    const { source, reads } = manualSource();
    const view = new SourceView(source, [new CacheMiddleware({ size: 1024 })]);
    const bytes = new ArrayBuffer(100);

    const failed = view.fetch(0, 100);
    reads[0]!.reject(new Error("HTTP 503"));
    await expect(failed).rejects.toThrow("HTTP 503");

    const retry = view.fetch(0, 100);
    expect(reads).toHaveLength(2);
    reads[1]!.resolve(bytes);
    await expect(retry).resolves.toBe(bytes);
  });

  it("a failed read the cache already dropped does not evict a newer read of the same range", async () => {
    const { source, reads } = manualSource();
    // Room for one 100-byte read, so each new range pushes older ones out.
    const view = new SourceView(source, [new CacheMiddleware({ size: 100 })]);

    const stale = view.fetch(0, 100);
    for (const offset of [100, 200, 300]) {
      const read = view.fetch(offset, 100);
      reads.at(-1)!.resolve(new ArrayBuffer(100));
      await read;
    }
    const fresh = view.fetch(0, 100);
    reads.at(-1)!.resolve(new ArrayBuffer(100));
    await fresh;
    expect(reads).toHaveLength(5);

    reads[0]!.reject(new Error("HTTP 503"));
    await expect(stale).rejects.toThrow("HTTP 503");

    // Still served by the fresh read.
    view.fetch(0, 100);
    expect(reads).toHaveLength(5);
  });
});
