import { describe, expect, it, vi } from "vitest";
import { sortByDistanceFromPoint } from "../../src/raster-tileset/sort-by-distance.js";

type Item = { id: string; x: number; y: number };

const getCenter = (item: Item): readonly [number, number] => [item.x, item.y];

describe("sortByDistanceFromPoint", () => {
  it("returns empty input unchanged", () => {
    const items: Item[] = [];
    const result = sortByDistanceFromPoint(items, {
      getCenter,
      reference: [0, 0],
    });
    expect(result).toBe(items);
    expect(result).toEqual([]);
  });

  it("returns single-item input unchanged", () => {
    const items: Item[] = [{ id: "a", x: 5, y: 5 }];
    const result = sortByDistanceFromPoint(items, {
      getCenter,
      reference: [0, 0],
    });
    expect(result).toBe(items);
    expect(result.map((i) => i.id)).toEqual(["a"]);
  });

  it("does not call getCenter for n < 2", () => {
    const spy = vi.fn(getCenter);
    const items: Item[] = [{ id: "a", x: 5, y: 5 }];
    sortByDistanceFromPoint(items, { getCenter: spy, reference: [0, 0] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("places the item at the reference point first", () => {
    const items: Item[] = [
      { id: "far", x: 10, y: 10 },
      { id: "mid", x: 3, y: 4 },
      { id: "at", x: 0, y: 0 },
    ];
    const result = sortByDistanceFromPoint(items, {
      getCenter,
      reference: [0, 0],
    });
    expect(result.map((i) => i.id)).toEqual(["at", "mid", "far"]);
  });

  it("sorts a ring of points around a non-origin reference correctly", () => {
    const items: Item[] = [
      { id: "near", x: 11, y: 10 },
      { id: "far", x: 20, y: 10 },
      { id: "mid", x: 13, y: 10 },
    ];
    const result = sortByDistanceFromPoint(items, {
      getCenter,
      reference: [10, 10],
    });
    expect(result.map((i) => i.id)).toEqual(["near", "mid", "far"]);
  });

  it("preserves original relative order for equidistant items (stable)", () => {
    const items: Item[] = [
      { id: "east", x: 5, y: 0 },
      { id: "north", x: 0, y: 5 },
      { id: "west", x: -5, y: 0 },
      { id: "south", x: 0, y: -5 },
    ];
    const result = sortByDistanceFromPoint(items, {
      getCenter,
      reference: [0, 0],
    });
    expect(result.map((i) => i.id)).toEqual(["east", "north", "west", "south"]);
  });

  it("sorts in place and returns the same array reference", () => {
    const items: Item[] = [
      { id: "far", x: 10, y: 10 },
      { id: "near", x: 1, y: 1 },
    ];
    const result = sortByDistanceFromPoint(items, {
      getCenter,
      reference: [0, 0],
    });
    expect(result).toBe(items);
    expect(items[0]!.id).toBe("near");
  });

  it("calls getCenter exactly n times (no per-comparison calls)", () => {
    const spy = vi.fn(getCenter);
    const items: Item[] = Array.from({ length: 20 }, (_, i) => ({
      id: `i${i}`,
      x: i,
      y: i,
    }));
    sortByDistanceFromPoint(items, { getCenter: spy, reference: [0, 0] });
    expect(spy).toHaveBeenCalledTimes(20);
  });
});
