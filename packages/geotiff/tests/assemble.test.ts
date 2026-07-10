import { describe, expect, it } from "vitest";
import type { RasterArray } from "../src/array.js";
import { assembleTiles } from "../src/assemble.js";
import type { Tile } from "../src/tile.js";

/** Helper: create a pixel-interleaved tile with sequential values. */
function makeInterleavedTile(opts: {
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
  /** Starting value for sequential fill. */
  startValue?: number;
}): Tile {
  const { x, y, width, height, count, startValue = 0 } = opts;
  const data = new Uint8Array(width * height * count);
  for (let i = 0; i < data.length; i++) {
    data[i] = (startValue + i) % 256;
  }
  const identity = [1, 0, 0, 0, 1, 0] as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const array: RasterArray = {
    layout: "pixel-interleaved",
    data,
    count,
    width,
    height,
    mask: null,
    transform: identity,
    crs: 4326,
    nodata: null,
  };
  return { x, y, array };
}

/** Helper: create a band-separate tile with sequential values per band. */
function makeBandSeparateTile(opts: {
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
  startValue?: number;
}): Tile {
  const { x, y, width, height, count, startValue = 0 } = opts;
  const bands = [];
  for (let b = 0; b < count; b++) {
    const band = new Uint8Array(width * height);
    for (let i = 0; i < band.length; i++) {
      band[i] = (startValue + b * 100 + i) % 256;
    }
    bands.push(band);
  }
  const identity = [1, 0, 0, 0, 1, 0] as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const array: RasterArray = {
    layout: "band-separate",
    bands,
    count,
    width,
    height,
    mask: null,
    transform: identity,
    crs: 4326,
    nodata: null,
  };
  return { x, y, array };
}

describe("assembleTiles", () => {
  describe("single tile (no stitching)", () => {
    it("returns the tile's array directly for pixel-interleaved", () => {
      const tile = makeInterleavedTile({
        x: 0,
        y: 0,
        width: 4,
        height: 4,
        count: 1,
      });
      const result = assembleTiles([tile], {
        width: 4,
        height: 4,
        tileWidth: 4,
        tileHeight: 4,
        minCol: 0,
        minRow: 0,
      });
      expect(result.width).toBe(4);
      expect(result.height).toBe(4);
      expect(result.layout).toBe("pixel-interleaved");
      expect(tile.array.layout).toBe("pixel-interleaved");
      if (
        result.layout === "pixel-interleaved" &&
        tile.array.layout === "pixel-interleaved"
      ) {
        expect(result.data).toEqual(tile.array.data);
      }
    });
  });

  describe("pixel-interleaved stitching", () => {
    it("stitches two tiles horizontally (single band)", () => {
      // Two 2x2 tiles side by side → 4x2 output
      const left = makeInterleavedTile({
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        count: 1,
        startValue: 10,
      });
      const right = makeInterleavedTile({
        x: 1,
        y: 0,
        width: 2,
        height: 2,
        count: 1,
        startValue: 20,
      });

      const result = assembleTiles([left, right], {
        width: 4,
        height: 2,
        tileWidth: 2,
        tileHeight: 2,
        minCol: 0,
        minRow: 0,
      });

      expect(result.width).toBe(4);
      expect(result.height).toBe(2);
      expect(result.layout).toBe("pixel-interleaved");
      if (result.layout === "pixel-interleaved") {
        // Row 0: left[0,1], right[0,1] = [10, 11, 20, 21]
        // Row 1: left[2,3], right[2,3] = [12, 13, 22, 23]
        expect(Array.from(result.data)).toEqual([
          10, 11, 20, 21, 12, 13, 22, 23,
        ]);
      }
    });

    it("stitches two tiles horizontally (multi-band)", () => {
      // Two 2x2 tiles with 3 bands each → 4x2 output
      const left = makeInterleavedTile({
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        count: 3,
        startValue: 0,
      });
      const right = makeInterleavedTile({
        x: 1,
        y: 0,
        width: 2,
        height: 2,
        count: 3,
        startValue: 100,
      });

      const result = assembleTiles([left, right], {
        width: 4,
        height: 2,
        tileWidth: 2,
        tileHeight: 2,
        minCol: 0,
        minRow: 0,
      });

      expect(result.width).toBe(4);
      expect(result.height).toBe(2);
      expect(result.count).toBe(3);
      if (result.layout === "pixel-interleaved") {
        // Row 0: left pixel(0,0)[3 bands] + left pixel(1,0)[3 bands] +
        //         right pixel(0,0)[3 bands] + right pixel(1,0)[3 bands]
        // left data:  [0,1,2, 3,4,5, ...]
        // right data: [100,101,102, 103,104,105, ...]
        // Row 0 output: [0,1,2, 3,4,5, 100,101,102, 103,104,105]
        const row0 = Array.from(result.data.subarray(0, 12));
        expect(row0).toEqual([0, 1, 2, 3, 4, 5, 100, 101, 102, 103, 104, 105]);
      }
    });

    it("stitches 2x2 grid of tiles", () => {
      // Four 2x2 tiles in a 2x2 grid → 4x4 output
      const tl = makeInterleavedTile({
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        count: 1,
        startValue: 1,
      });
      const tr = makeInterleavedTile({
        x: 1,
        y: 0,
        width: 2,
        height: 2,
        count: 1,
        startValue: 5,
      });
      const bl = makeInterleavedTile({
        x: 0,
        y: 1,
        width: 2,
        height: 2,
        count: 1,
        startValue: 9,
      });
      const br = makeInterleavedTile({
        x: 1,
        y: 1,
        width: 2,
        height: 2,
        count: 1,
        startValue: 13,
      });

      const result = assembleTiles([tl, tr, bl, br], {
        width: 4,
        height: 4,
        tileWidth: 2,
        tileHeight: 2,
        minCol: 0,
        minRow: 0,
      });

      expect(result.width).toBe(4);
      expect(result.height).toBe(4);
      if (result.layout === "pixel-interleaved") {
        // Row 0: tl row0 [1,2] + tr row0 [5,6]
        // Row 1: tl row1 [3,4] + tr row1 [7,8]
        // Row 2: bl row0 [9,10] + br row0 [13,14]
        // Row 3: bl row1 [11,12] + br row1 [15,16]
        expect(Array.from(result.data)).toEqual([
          1, 2, 5, 6, 3, 4, 7, 8, 9, 10, 13, 14, 11, 12, 15, 16,
        ]);
      }
    });

    it("handles non-zero minCol/minRow offset", () => {
      // A single tile at position (3, 5) with minCol=3, minRow=5
      const tile = makeInterleavedTile({
        x: 3,
        y: 5,
        width: 2,
        height: 2,
        count: 1,
        startValue: 42,
      });

      const result = assembleTiles([tile], {
        width: 2,
        height: 2,
        tileWidth: 2,
        tileHeight: 2,
        minCol: 3,
        minRow: 5,
      });

      if (result.layout === "pixel-interleaved") {
        expect(Array.from(result.data)).toEqual([42, 43, 44, 45]);
      }
    });
  });

  describe("band-separate stitching", () => {
    it("stitches two tiles horizontally", () => {
      const left = makeBandSeparateTile({
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        count: 2,
        startValue: 0,
      });
      const right = makeBandSeparateTile({
        x: 1,
        y: 0,
        width: 2,
        height: 2,
        count: 2,
        startValue: 50,
      });

      const result = assembleTiles([left, right], {
        width: 4,
        height: 2,
        tileWidth: 2,
        tileHeight: 2,
        minCol: 0,
        minRow: 0,
      });

      expect(result.width).toBe(4);
      expect(result.height).toBe(2);
      expect(result.count).toBe(2);
      expect(result.layout).toBe("band-separate");
      if (result.layout === "band-separate") {
        // Band 0: left startValue=0, right startValue=50
        // Left band 0: [0,1,2,3] in 2x2 → row0=[0,1], row1=[2,3]
        // Right band 0: [50,51,52,53] → row0=[50,51], row1=[52,53]
        // Output band 0 (4x2): row0=[0,1,50,51], row1=[2,3,52,53]
        expect(Array.from(result.bands[0]!)).toEqual([
          0, 1, 50, 51, 2, 3, 52, 53,
        ]);
      }
    });
  });

  describe("mask stitching", () => {
    it("stitches masks alongside data", () => {
      const identity = [1, 0, 0, 0, 1, 0] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const left: Tile = {
        x: 0,
        y: 0,
        array: {
          layout: "pixel-interleaved",
          data: new Uint8Array([1, 2, 3, 4]),
          count: 1,
          width: 2,
          height: 2,
          mask: new Uint8Array([255, 255, 0, 0]),
          transform: identity,
          crs: 4326,
          nodata: null,
        },
      };
      const right: Tile = {
        x: 1,
        y: 0,
        array: {
          layout: "pixel-interleaved",
          data: new Uint8Array([5, 6, 7, 8]),
          count: 1,
          width: 2,
          height: 2,
          mask: new Uint8Array([0, 0, 255, 255]),
          transform: identity,
          crs: 4326,
          nodata: null,
        },
      };

      const result = assembleTiles([left, right], {
        width: 4,
        height: 2,
        tileWidth: 2,
        tileHeight: 2,
        minCol: 0,
        minRow: 0,
      });

      expect(result.mask).not.toBeNull();
      // Row 0: left mask [255,255] + right mask [0,0]
      // Row 1: left mask [0,0] + right mask [255,255]
      expect(Array.from(result.mask!)).toEqual([
        255, 255, 0, 0, 0, 0, 255, 255,
      ]);
    });
  });

  describe("typed array preservation", () => {
    it("preserves Float32Array type", () => {
      const identity = [1, 0, 0, 0, 1, 0] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const tile: Tile = {
        x: 0,
        y: 0,
        array: {
          layout: "pixel-interleaved",
          data: new Float32Array([1.5, 2.5, 3.5, 4.5]),
          count: 1,
          width: 2,
          height: 2,
          mask: null,
          transform: identity,
          crs: 4326,
          nodata: null,
        },
      };

      const result = assembleTiles([tile], {
        width: 2,
        height: 2,
        tileWidth: 2,
        tileHeight: 2,
        minCol: 0,
        minRow: 0,
      });

      if (result.layout === "pixel-interleaved") {
        expect(result.data).toBeInstanceOf(Float32Array);
        expect(Array.from(result.data)).toEqual([1.5, 2.5, 3.5, 4.5]);
      }
    });
  });
});
