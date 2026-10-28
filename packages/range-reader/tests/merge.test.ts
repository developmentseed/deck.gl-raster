import { describe, expect, it } from "vitest";
import type { MergeOptions } from "../src/merge.js";
import { mergeReads, widenRead } from "../src/merge.js";

const big: MergeOptions = {
  maxGap: 0,
  maxOverfetchBytes: 1 << 30,
  maxRequestBytes: 1 << 30,
};

describe("mergeReads", () => {
  it("joins adjacent reads", () => {
    expect(
      mergeReads(
        [
          { offset: 0, length: 10 },
          { offset: 10, length: 10 },
        ],
        big,
      ),
    ).toEqual([{ offset: 0, length: 20, members: [0, 1], overfetch: 0 }]);
  });

  it("splits on a gap wider than maxGap and joins one within it", () => {
    const reads = [
      { offset: 0, length: 10 },
      { offset: 20, length: 10 },
    ];
    expect(mergeReads(reads, { ...big, maxGap: 5 })).toHaveLength(2);
    expect(mergeReads(reads, { ...big, maxGap: 10 })).toEqual([
      { offset: 0, length: 30, members: [0, 1], overfetch: 10 },
    ]);
  });

  it("always joins a contained read", () => {
    expect(
      mergeReads(
        [
          { offset: 10, length: 20 },
          { offset: 0, length: 100 },
        ],
        big,
      ),
    ).toEqual([{ offset: 0, length: 100, members: [1, 0], overfetch: 0 }]);
  });

  it("joins an overlapping read even past maxRequestBytes", () => {
    expect(
      mergeReads(
        [
          { offset: 0, length: 100 },
          { offset: 50, length: 100 },
        ],
        { ...big, maxRequestBytes: 120 },
      ),
    ).toEqual([{ offset: 0, length: 150, members: [0, 1], overfetch: 0 }]);
  });

  it("splits when the over-fetch cap would be exceeded", () => {
    const reads = [
      { offset: 0, length: 10 },
      { offset: 20, length: 10 },
      { offset: 40, length: 10 },
    ];
    expect(
      mergeReads(reads, { ...big, maxGap: 100, maxOverfetchBytes: 15 }),
    ).toEqual([
      { offset: 0, length: 30, members: [0, 1], overfetch: 10 },
      { offset: 40, length: 10, members: [2], overfetch: 0 },
    ]);
  });

  it("splits when the request cap would be exceeded", () => {
    expect(
      mergeReads(
        [
          { offset: 0, length: 10 },
          { offset: 20, length: 10 },
        ],
        { ...big, maxGap: 100, maxRequestBytes: 25 },
      ),
    ).toHaveLength(2);
  });

  it("uses the lower-middle read length as the median gap", () => {
    const reads = [
      { offset: 0, length: 10 },
      { offset: 30, length: 20 },
      { offset: 70, length: 30 },
      { offset: 140, length: 40 },
    ];
    expect(
      mergeReads(reads, { ...big, maxGap: "median" }).map((r) => [
        r.offset,
        r.length,
      ]),
    ).toEqual([
      [0, 100],
      [140, 40],
    ]);
  });

  it("returns ranges in offset order whatever the input order", () => {
    expect(
      mergeReads(
        [
          { offset: 500, length: 1 },
          { offset: 0, length: 1 },
        ],
        big,
      ).map((r) => r.offset),
    ).toEqual([0, 500]);
  });

  it("returns nothing for no reads", () => {
    expect(mergeReads([], big)).toEqual([]);
  });
});

describe("widenRead", () => {
  it("widens a small read to its aligned block and leaves large reads alone", () => {
    expect(widenRead({ offset: 100, length: 8 }, 64)).toEqual({
      offset: 64,
      length: 64,
    });
    expect(widenRead({ offset: 60, length: 10 }, 64)).toEqual({
      offset: 0,
      length: 128,
    });
    expect(widenRead({ offset: 130, length: 200 }, 64)).toEqual({
      offset: 130,
      length: 200,
    });
  });
});
