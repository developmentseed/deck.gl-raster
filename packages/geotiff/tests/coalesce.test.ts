import { describe, expect, it } from "vitest";
import { coalesceRanges } from "../src/coalesce.js";

/**
 * In-memory source that records every fetch. `delayTicks` makes each fetch await
 * that many microtasks before resolving, so concurrency is observable.
 */
class RecordingSource {
  fetches: { offset: number; length: number }[] = [];
  inflight = 0;
  peakInflight = 0;
  delayTicks = 0;

  constructor(private readonly buffer: Uint8Array) {}

  async fetch(offset: number, length: number): Promise<ArrayBuffer> {
    this.fetches.push({ offset, length });
    this.inflight++;
    if (this.inflight > this.peakInflight) {
      this.peakInflight = this.inflight;
    }
    try {
      for (let i = 0; i < this.delayTicks; i++) {
        await Promise.resolve();
      }
      const slice = this.buffer.slice(offset, offset + length);
      return slice.buffer.slice(
        slice.byteOffset,
        slice.byteOffset + slice.byteLength,
      ) as ArrayBuffer;
    } finally {
      this.inflight--;
    }
  }
}

/** Build a buffer where each byte equals `index % 256`. */
function makeBuffer(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    buf[i] = i & 0xff;
  }
  return buf;
}

describe("coalesceRanges", () => {
  it("returns [] and makes no fetches for empty input", async () => {
    const source = new RecordingSource(makeBuffer(64));
    const result = await coalesceRanges(source, []);
    expect(result).toEqual([]);
    expect(source.fetches.length).toBe(0);
  });

  it("fetches a single range as one source call", async () => {
    const source = new RecordingSource(makeBuffer(64));
    const result = await coalesceRanges(source, [{ offset: 10, length: 5 }]);

    expect(result.length).toBe(1);
    expect(new Uint8Array(result[0]!)).toEqual(
      new Uint8Array([10, 11, 12, 13, 14]),
    );
    expect(source.fetches).toEqual([{ offset: 10, length: 5 }]);
  });

  it("merges two adjacent ranges within coalesce gap into one fetch", async () => {
    const source = new RecordingSource(makeBuffer(128));
    const result = await coalesceRanges(
      source,
      [
        { offset: 10, length: 4 },
        { offset: 20, length: 4 },
      ],
      { coalesce: 16 },
    );

    expect(source.fetches).toEqual([{ offset: 10, length: 14 }]);
    expect(new Uint8Array(result[0]!)).toEqual(
      new Uint8Array([10, 11, 12, 13]),
    );
    expect(new Uint8Array(result[1]!)).toEqual(
      new Uint8Array([20, 21, 22, 23]),
    );
  });

  it("does not merge ranges with gap larger than coalesce", async () => {
    const source = new RecordingSource(makeBuffer(256));
    const result = await coalesceRanges(
      source,
      [
        { offset: 0, length: 4 },
        { offset: 100, length: 4 },
      ],
      { coalesce: 16 },
    );

    expect(source.fetches).toEqual([
      { offset: 0, length: 4 },
      { offset: 100, length: 4 },
    ]);
    expect(new Uint8Array(result[0]!)).toEqual(new Uint8Array([0, 1, 2, 3]));
    expect(new Uint8Array(result[1]!)).toEqual(
      new Uint8Array([100, 101, 102, 103]),
    );
  });

  it("refuses to merge when the result would exceed maxRangeSize", async () => {
    const source = new RecordingSource(makeBuffer(1000));
    const result = await coalesceRanges(
      source,
      [
        { offset: 0, length: 100 },
        { offset: 110, length: 100 },
      ],
      { coalesce: 32, maxRangeSize: 150 },
    );

    expect(source.fetches).toEqual([
      { offset: 0, length: 100 },
      { offset: 110, length: 100 },
    ]);
    expect(result[0]!.byteLength).toBe(100);
    expect(result[1]!.byteLength).toBe(100);
  });

  it("fetches a single oversized range in full (does not truncate input)", async () => {
    const source = new RecordingSource(makeBuffer(500));
    const result = await coalesceRanges(source, [{ offset: 0, length: 400 }], {
      maxRangeSize: 100,
    });

    expect(source.fetches).toEqual([{ offset: 0, length: 400 }]);
    expect(result[0]!.byteLength).toBe(400);
  });

  it("handles duplicate input ranges by reusing the same merged group", async () => {
    const source = new RecordingSource(makeBuffer(64));
    const result = await coalesceRanges(source, [
      { offset: 5, length: 3 },
      { offset: 5, length: 3 },
    ]);

    expect(source.fetches.length).toBe(1);
    expect(new Uint8Array(result[0]!)).toEqual(new Uint8Array([5, 6, 7]));
    expect(new Uint8Array(result[1]!)).toEqual(new Uint8Array([5, 6, 7]));
  });

  it("handles overlapping input ranges", async () => {
    const source = new RecordingSource(makeBuffer(64));
    const result = await coalesceRanges(
      source,
      [
        { offset: 5, length: 10 },
        { offset: 10, length: 10 },
      ],
      { coalesce: 16 },
    );

    expect(source.fetches).toEqual([{ offset: 5, length: 15 }]);
    expect(new Uint8Array(result[0]!)).toEqual(
      new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
    );
    expect(new Uint8Array(result[1]!)).toEqual(
      new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]),
    );
  });

  it("throws when source.fetch returns fewer bytes than requested", async () => {
    const source = {
      fetch(_offset: number, length: number): Promise<ArrayBuffer> {
        return Promise.resolve(new ArrayBuffer(length - 1));
      },
    };

    await expect(
      coalesceRanges(source, [{ offset: 0, length: 10 }]),
    ).rejects.toThrow(/Failed to fetch bytes from offset:0 wanted:10 got:9/);
  });

  it("forwards AbortSignal to source.fetch", async () => {
    const seenSignals: (AbortSignal | undefined)[] = [];
    const source = {
      fetch(
        _offset: number,
        length: number,
        options?: { signal?: AbortSignal },
      ): Promise<ArrayBuffer> {
        seenSignals.push(options?.signal);
        return Promise.resolve(new ArrayBuffer(length));
      },
    };
    const controller = new AbortController();

    await coalesceRanges(
      source,
      [
        { offset: 0, length: 4 },
        { offset: 100, length: 4 },
      ],
      { coalesce: 8, signal: controller.signal },
    );

    expect(seenSignals.length).toBe(2);
    for (const s of seenSignals) {
      expect(s).toBe(controller.signal);
    }
  });

  it("caps in-flight source.fetch calls at 10", async () => {
    const source = new RecordingSource(makeBuffer(10_000));
    source.delayTicks = 5;

    const ranges = Array.from({ length: 25 }, (_, i) => ({
      offset: i * 200,
      length: 4,
    }));
    await coalesceRanges(source, ranges, { coalesce: 8 });

    expect(source.fetches.length).toBe(25);
    expect(source.peakInflight).toBeLessThanOrEqual(10);
  });

  it("returns results in input order even when input is out of offset order", async () => {
    const source = new RecordingSource(makeBuffer(256));
    const result = await coalesceRanges(
      source,
      [
        { offset: 200, length: 4 },
        { offset: 0, length: 4 },
        { offset: 100, length: 4 },
      ],
      { coalesce: 8 },
    );

    expect(new Uint8Array(result[0]!)).toEqual(
      new Uint8Array([200, 201, 202, 203]),
    );
    expect(new Uint8Array(result[1]!)).toEqual(new Uint8Array([0, 1, 2, 3]));
    expect(new Uint8Array(result[2]!)).toEqual(
      new Uint8Array([100, 101, 102, 103]),
    );
  });
});
