import { describe, expect, it, vi } from "vitest";
import type { TileBorder } from "../src/terrain/halo.js";
import { TileBorders } from "../src/terrain/tile-borders.js";

/** A 2 x 2 tile's border whose every sample is `value`. */
function border(value: number): TileBorder {
  const edge = () => Float32Array.from([value, value]);
  return { top: edge(), bottom: edge(), left: edge(), right: edge() };
}

const A = { z: 3, x: 2, y: 2 };
const EAST_OF_A = { z: 3, x: 3, y: 2 };
const FAR_FROM_A = { z: 3, x: 6, y: 6 };

describe("TileBorders", () => {
  it("remembers a loaded tile's border", () => {
    const borders = new TileBorders({ capacity: 10 });
    borders.add(A, border(1));
    expect(borders.get(A)).toEqual(border(1));
    expect(borders.get(EAST_OF_A)).toBeUndefined();
  });

  it("tells a loaded neighbor when a tile's border arrives", () => {
    const borders = new TileBorders({ capacity: 10 });
    const onNeighbor = vi.fn();
    borders.watch(A, onNeighbor);
    expect(borders.add(EAST_OF_A, border(2))).toBe(1);
    expect(onNeighbor).toHaveBeenCalledTimes(1);
  });

  it("tells no one about a tile that isn't a neighbor", () => {
    const borders = new TileBorders({ capacity: 10 });
    const onNeighbor = vi.fn();
    borders.watch(A, onNeighbor);
    expect(borders.add(FAR_FROM_A, border(2))).toBe(0);
    expect(onNeighbor).not.toHaveBeenCalled();
  });

  it("tells a neighbor once even when it borders the tile on two sides", () => {
    // At z1, tiles x=0 and x=1 are each other's east and west neighbors.
    const borders = new TileBorders({ capacity: 10 });
    const onNeighbor = vi.fn();
    borders.watch({ z: 1, x: 0, y: 0 }, onNeighbor);
    borders.add({ z: 1, x: 1, y: 0 }, border(2));
    expect(onNeighbor).toHaveBeenCalledTimes(1);
  });

  it("stops telling a tile once it stops watching", () => {
    const borders = new TileBorders({ capacity: 10 });
    const onNeighbor = vi.fn();
    const stop = borders.watch(A, onNeighbor);
    stop();
    expect(borders.add(EAST_OF_A, border(2))).toBe(0);
    expect(onNeighbor).not.toHaveBeenCalled();
  });

  it("keeps telling a reloaded tile after its earlier copy stops watching", () => {
    const borders = new TileBorders({ capacity: 10 });
    const earlier = vi.fn();
    const reloaded = vi.fn();
    const stopEarlier = borders.watch(A, earlier);
    borders.watch(A, reloaded);
    stopEarlier();
    borders.add(EAST_OF_A, border(2));
    expect(earlier).not.toHaveBeenCalled();
    expect(reloaded).toHaveBeenCalledTimes(1);
  });

  it("forgets the least recently used borders beyond capacity", () => {
    const borders = new TileBorders({ capacity: 2 });
    borders.add({ z: 3, x: 0, y: 0 }, border(1));
    borders.add({ z: 3, x: 1, y: 0 }, border(2));
    // Reading x=0 makes x=1 the least recently used.
    borders.get({ z: 3, x: 0, y: 0 });
    borders.add({ z: 3, x: 2, y: 0 }, border(3));
    expect(borders.get({ z: 3, x: 1, y: 0 })).toBeUndefined();
    expect(borders.get({ z: 3, x: 0, y: 0 })).toEqual(border(1));
    expect(borders.get({ z: 3, x: 2, y: 0 })).toEqual(border(3));
  });
});
