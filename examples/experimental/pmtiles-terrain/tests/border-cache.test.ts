import { describe, expect, it, vi } from "vitest";
import { BorderCache } from "../src/terrain/border-cache.js";
import type { TileIndex } from "../src/terrain/neighbors.js";

type LoadCall = {
  tile: TileIndex;
  signal: AbortSignal;
  resolve: (elevation: Float32Array | null) => void;
  reject: (error: unknown) => void;
};

/**
 * A load whose results the test settles by hand. Like a real load, it
 * rejects with its signal's reason when the signal aborts.
 */
function fakeLoad() {
  const calls: LoadCall[] = [];
  const load = vi.fn(
    (tile: TileIndex, signal: AbortSignal) =>
      new Promise<Float32Array | null>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        calls.push({ tile, signal, resolve, reject });
      }),
  );
  return { load, calls };
}

/** Let settled promises run their handlers. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const A = { z: 3, x: 1, y: 2 };
const B = { z: 3, x: 2, y: 2 };
const C = { z: 3, x: 3, y: 2 };
const D = { z: 3, x: 4, y: 2 };

/** A 2 x 2 tile: 1 2 / 3 4. */
const tile = () => Float32Array.from([1, 2, 3, 4]);
const border = {
  top: Float32Array.from([1, 2]),
  bottom: Float32Array.from([3, 4]),
  left: Float32Array.from([1, 3]),
  right: Float32Array.from([2, 4]),
};

function makeCache(capacity = 10) {
  const { load, calls } = fakeLoad();
  const cache = new BorderCache({ load, tileSize: 2, capacity });
  return { cache, load, calls };
}

describe("BorderCache", () => {
  it("calls load synchronously, so one task's reads stay together", () => {
    const { cache, load } = makeCache();
    void cache.getBorder(A);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0]).toEqual(A);
  });

  it("shares one load between getElevation and getBorder of a tile", async () => {
    const { cache, calls } = makeCache();
    const elevation = cache.getElevation(A);
    const borderPromise = cache.getBorder(A);
    expect(cache.stats.loads).toBe(1);
    const data = tile();
    calls[0]!.resolve(data);
    await expect(elevation).resolves.toBe(data);
    await expect(borderPromise).resolves.toEqual(border);
  });

  it("answers a settled border without loading", async () => {
    const { cache, calls } = makeCache();
    void cache.getBorder(A);
    calls[0]!.resolve(tile());
    await flush();
    expect(cache.peekBorder(A)).toEqual(border);
    await expect(cache.getBorder(A)).resolves.toEqual(border);
    expect(cache.stats.loads).toBe(1);
  });

  it("loads again for the elevation of a settled tile", async () => {
    const { cache, calls } = makeCache();
    void cache.getBorder(A);
    calls[0]!.resolve(tile());
    await flush();
    void cache.getElevation(A);
    expect(cache.stats.loads).toBe(2);
  });

  it("keeps a settled border while the tile's elevation reloads", async () => {
    const { cache, calls } = makeCache();
    void cache.getBorder(A);
    calls[0]!.resolve(tile());
    await flush();
    void cache.getElevation(A);
    expect(cache.peekBorder(A)).toEqual(border);
    await expect(cache.getBorder(A)).resolves.toEqual(border);
    expect(cache.stats.loads).toBe(2);
  });

  it("keeps a load while one waiter remains", async () => {
    const { cache, calls } = makeCache();
    const first = new AbortController();
    const second = new AbortController();
    const elevation = cache.getElevation(A, first.signal);
    const borderPromise = cache.getBorder(A, second.signal);
    first.abort();
    await expect(elevation).rejects.toBe(first.signal.reason);
    expect(calls[0]!.signal.aborted).toBe(false);
    calls[0]!.resolve(tile());
    await expect(borderPromise).resolves.toEqual(border);
  });

  it("aborts the load once every waiter has aborted", async () => {
    const { cache, calls } = makeCache();
    const first = new AbortController();
    const second = new AbortController();
    const elevation = cache.getElevation(A, first.signal);
    const borderPromise = cache.getBorder(A, second.signal);
    first.abort();
    second.abort();
    expect(calls[0]!.signal.aborted).toBe(true);
    await expect(elevation).rejects.toBe(first.signal.reason);
    await expect(borderPromise).rejects.toBe(second.signal.reason);
    expect(cache.peekBorder(A)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("lets a waiter without a signal keep the load", async () => {
    const { cache, calls } = makeCache();
    const controller = new AbortController();
    const borderPromise = cache.getBorder(A);
    void cache.getElevation(A, controller.signal).catch(() => {});
    controller.abort();
    expect(calls[0]!.signal.aborted).toBe(false);
    calls[0]!.resolve(tile());
    await expect(borderPromise).resolves.toEqual(border);
  });

  it("doesn't let a waiter whose signal already aborted hold the load", async () => {
    const { cache, calls } = makeCache();
    const controller = new AbortController();
    controller.abort();
    await expect(cache.getElevation(A, controller.signal)).rejects.toBe(
      controller.signal.reason,
    );
    expect(calls[0]!.signal.aborted).toBe(true);
  });

  it("doesn't cache a failed load", async () => {
    const { cache, calls } = makeCache();
    const failure = new Error("network");
    const borderPromise = cache.getBorder(A);
    calls[0]!.reject(failure);
    await expect(borderPromise).rejects.toBe(failure);
    void cache.getBorder(A);
    expect(cache.stats.loads).toBe(2);
  });

  it("caches a missing tile as null", async () => {
    const { cache, calls } = makeCache();
    const borderPromise = cache.getBorder(A);
    calls[0]!.resolve(null);
    await expect(borderPromise).resolves.toBeNull();
    expect(cache.peekBorder(A)).toBeNull();
    await expect(cache.getBorder(A)).resolves.toBeNull();
    expect(cache.stats.loads).toBe(1);
  });

  it("evicts the least recently used settled border beyond capacity", async () => {
    const { cache, calls } = makeCache(2);
    for (const t of [A, B, C]) {
      void cache.getBorder(t);
    }
    for (const call of calls) {
      call.resolve(tile());
    }
    await flush();
    expect(cache.peekBorder(A)).toBeUndefined();
    expect(cache.peekBorder(B)).toEqual(border);
    expect(cache.peekBorder(C)).toEqual(border);

    // Reading B makes C the least recently used.
    await cache.getBorder(B);
    void cache.getBorder(D);
    calls[3]!.resolve(tile());
    await flush();
    expect(cache.peekBorder(C)).toBeUndefined();
    expect(cache.peekBorder(B)).toEqual(border);
    expect(cache.peekBorder(D)).toEqual(border);
  });

  it("never evicts a load in flight", async () => {
    const { cache, calls } = makeCache(1);
    void cache.getBorder(A);
    void cache.getBorder(B);
    calls[1]!.resolve(tile());
    await flush();
    expect(cache.size).toBe(2);
    calls[0]!.resolve(tile());
    await flush();
    expect(cache.peekBorder(A)).toEqual(border);
    expect(cache.peekBorder(B)).toBeUndefined();
  });
});
