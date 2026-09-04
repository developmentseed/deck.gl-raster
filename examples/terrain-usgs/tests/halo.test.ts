import { describe, expect, it } from "vitest";
import { buildHaloArray, CENTER_INDEX, neighborIndex } from "../src/halo.js";

/**
 * Build a 2×2 tile whose every sample is `value`, so a neighbor's
 * contribution to the halo is identifiable by value alone.
 */
function constantTile(value: number): Float32Array {
  return new Float32Array([value, value, value, value]);
}

/** Read row `y` of a padded `width`-wide array as a plain number array. */
function row(array: Float32Array, width: number, y: number): number[] {
  return Array.from(array.subarray(y * width, (y + 1) * width));
}

describe("neighborIndex", () => {
  it("puts the center tile at CENTER_INDEX", () => {
    expect(neighborIndex(0, 0)).toBe(CENTER_INDEX);
  });

  it("orders the grid row-major from the top-left", () => {
    expect(neighborIndex(-1, -1)).toBe(0);
    expect(neighborIndex(1, 1)).toBe(8);
  });
});

describe("buildHaloArray", () => {
  // A 2×2 center tile of distinct values, so transposition is detectable:
  //   1 2
  //   3 4
  const center = new Float32Array([1, 2, 3, 4]);

  /** All eight neighbors present, each a distinct constant. */
  function allNeighbors(): Array<Float32Array | null> {
    const tiles: Array<Float32Array | null> = [
      constantTile(10), // NW
      constantTile(20), // N
      constantTile(30), // NE
      constantTile(40), // W
      null, // center, filled below
      constantTile(60), // E
      constantTile(70), // SW
      constantTile(80), // S
      constantTile(90), // SE
    ];
    tiles[CENTER_INDEX] = center;
    return tiles;
  }

  it("returns a (w+2) x (h+2) array", () => {
    const out = buildHaloArray({
      tiles: allNeighbors(),
      tileWidth: 2,
      tileHeight: 2,
    });
    expect(out.length).toBe(16);
  });

  it("insets the center tile by one texel", () => {
    const out = buildHaloArray({
      tiles: allNeighbors(),
      tileWidth: 2,
      tileHeight: 2,
    });
    expect(row(out, 4, 1).slice(1, 3)).toEqual([1, 2]);
    expect(row(out, 4, 2).slice(1, 3)).toEqual([3, 4]);
  });

  it("fills the ring from the eight neighbors, corners included", () => {
    const out = buildHaloArray({
      tiles: allNeighbors(),
      tileWidth: 2,
      tileHeight: 2,
    });
    // Corners come from the diagonal neighbors; edges from the orthogonal
    // ones. Every ring texel is the nearest sample of its source tile.
    expect(row(out, 4, 0)).toEqual([10, 20, 20, 30]);
    expect(row(out, 4, 1)).toEqual([40, 1, 2, 60]);
    expect(row(out, 4, 2)).toEqual([40, 3, 4, 60]);
    expect(row(out, 4, 3)).toEqual([70, 80, 80, 90]);
  });

  it("replicates the center edge where a neighbor is absent", () => {
    const tiles = allNeighbors();
    tiles[neighborIndex(-1, 0)] = null; // no western neighbor
    tiles[neighborIndex(-1, -1)] = null; // no north-western neighbor

    const out = buildHaloArray({ tiles, tileWidth: 2, tileHeight: 2 });

    // The west column mirrors the center's own left column (1, 3), and the
    // absent NW corner clamps to the center's top-left sample (1).
    expect(row(out, 4, 0)[0]).toBe(1);
    expect(row(out, 4, 1)[0]).toBe(1);
    expect(row(out, 4, 2)[0]).toBe(3);
  });

  it("handles a corner tile with only three neighbors", () => {
    const tiles: Array<Float32Array | null> = [
      null,
      null,
      null,
      null,
      center,
      constantTile(60), // E
      null,
      constantTile(80), // S
      constantTile(90), // SE
    ];

    const out = buildHaloArray({ tiles, tileWidth: 2, tileHeight: 2 });

    // South and east come from real neighbors. Every absent direction —
    // including the NE and SW corners, which are absent even though E and S
    // are present — replicates the center tile's own edge.
    expect(row(out, 4, 0)).toEqual([1, 1, 2, 2]);
    expect(row(out, 4, 3)).toEqual([3, 80, 80, 90]);
  });

  it("rejects a missing center tile", () => {
    const tiles = allNeighbors();
    tiles[CENTER_INDEX] = null;
    expect(() =>
      buildHaloArray({ tiles, tileWidth: 2, tileHeight: 2 }),
    ).toThrow(/center tile is required/);
  });

  it("rejects a tile of the wrong length", () => {
    const tiles = allNeighbors();
    tiles[neighborIndex(1, 0)] = new Float32Array([1, 2, 3]);
    expect(() =>
      buildHaloArray({ tiles, tileWidth: 2, tileHeight: 2 }),
    ).toThrow(/expected 4/);
  });
});
