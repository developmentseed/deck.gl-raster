import { describe, expect, it, vi } from "vitest";
import { TileBatcher } from "../src/raster-tile-layer/tile-batcher.js";

type FakeTile = { x: number; y: number; z: number };

function makeBatcher(
  dispatch: (
    key: string,
    items: FakeTile[],
    opts: { signal: AbortSignal },
  ) => Promise<Array<number | Error>>,
) {
  return new TileBatcher<FakeTile, number>({
    groupKey: (t) => `z${t.z}`,
    dispatch,
  });
}

const flushTick = () => new Promise((r) => setTimeout(r, 0));

describe("TileBatcher", () => {
  it("coalesces one tick of fetch() calls into one dispatch per group key", async () => {
    const seen: Array<[string, FakeTile[]]> = [];
    const b = makeBatcher(async (key, items) => {
      seen.push([key, items]);
      return items.map((_, i) => i);
    });
    const a = b.fetch({ x: 0, y: 0, z: 1 });
    const c = b.fetch({ x: 1, y: 0, z: 1 });
    const d = b.fetch({ x: 0, y: 0, z: 2 });
    expect(await Promise.all([a, c, d])).toEqual([0, 1, 0]);
    expect(seen).toEqual([
      [
        "z1",
        [
          { x: 0, y: 0, z: 1 },
          { x: 1, y: 0, z: 1 },
        ],
      ],
      ["z2", [{ x: 0, y: 0, z: 2 }]],
    ]);
  });

  it("distributes per-item Errors only to the failing item", async () => {
    const b = makeBatcher(async (_key, items) =>
      items.map((_t, i) => (i === 1 ? new Error("bad tile") : i)),
    );
    const r0 = b.fetch({ x: 0, y: 0, z: 1 });
    const r1 = b.fetch({ x: 1, y: 0, z: 1 });
    const r2 = b.fetch({ x: 2, y: 0, z: 1 });
    expect(await r0).toBe(0);
    await expect(r1).rejects.toThrow("bad tile");
    expect(await r2).toBe(2);
  });

  it("rejects every item in a group when the dispatch itself rejects", async () => {
    const b = makeBatcher(async () => {
      throw new Error("whole batch failed");
    });
    const r0 = b.fetch({ x: 0, y: 0, z: 1 });
    const r1 = b.fetch({ x: 1, y: 0, z: 1 });
    await expect(r0).rejects.toThrow("whole batch failed");
    await expect(r1).rejects.toThrow("whole batch failed");
  });

  it("drops an item whose signal is already aborted before flush", async () => {
    const dispatch = vi.fn(async (_k: string, items: FakeTile[]) =>
      items.map((_, i) => i as number | Error),
    );
    const b = makeBatcher(dispatch);
    const ac = new AbortController();
    ac.abort(new Error("scrolled off"));
    const aborted = b.fetch({ x: 0, y: 0, z: 1 }, { signal: ac.signal });
    const ok = b.fetch({ x: 1, y: 0, z: 1 });
    await expect(aborted).rejects.toThrow("scrolled off");
    expect(await ok).toBe(0); // re-indexed within the surviving group
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![1]).toEqual([{ x: 1, y: 0, z: 1 }]);
  });

  it("composite signal aborts only when every member aborts", async () => {
    let captured!: AbortSignal;
    const b = new TileBatcher<FakeTile, number>({
      groupKey: (t) => `z${t.z}`,
      dispatch: async (_k, items, opts) => {
        captured = opts.signal;
        // Hold the dispatch open long enough to observe abort state.
        await new Promise((r) => setTimeout(r, 30));
        return items.map((_, i) => i);
      },
    });
    const a = new AbortController();
    const c = new AbortController();
    const ra = b.fetch({ x: 0, y: 0, z: 1 }, { signal: a.signal });
    const rc = b.fetch({ x: 1, y: 0, z: 1 }, { signal: c.signal });
    await flushTick();
    expect(captured.aborted).toBe(false);
    a.abort();
    expect(captured.aborted).toBe(false); // not all aborted yet
    c.abort();
    expect(captured.aborted).toBe(true);
    // Both tiles' promises reject (their per-tile signals are aborted at distribute time).
    await expect(ra).rejects.toBeDefined();
    await expect(rc).rejects.toBeDefined();
  });

  it("finalize() rejects everything still buffered and dispatches nothing more", async () => {
    const dispatch = vi.fn(async () => [] as number[]);
    const b = makeBatcher(dispatch);
    const r = b.fetch({ x: 0, y: 0, z: 1 });
    b.finalize();
    await expect(r).rejects.toThrow();
    await flushTick();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fetch() after finalize() rejects immediately", async () => {
    const b = makeBatcher(async (_k, items) => items.map((_, i) => i));
    b.finalize();
    await expect(b.fetch({ x: 0, y: 0, z: 1 })).rejects.toThrow();
  });
});
