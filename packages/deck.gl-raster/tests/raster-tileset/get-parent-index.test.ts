import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import { describe, expect, it } from "vitest";
import { RasterTileset2D } from "../../src/raster-tileset/raster-tileset-2d.js";
import { TileMatrixSetAdaptor } from "../../src/raster-tileset/tile-matrix-set.js";

// The OGC TMS 2.0 example WebMercatorQuad. Its scale denominators are rounded
// decimals, so the ratio between some consecutive levels comes out slightly
// above 2, e.g. z7 / z8 = 2.0000000000000044.
const WEB_MERCATOR_QUAD: TileMatrixSet = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../../../morecantile/spec/schemas/tms/2.0/json/examples/tilematrixset/WebMercatorQuad.json",
    ),
    "utf8",
  ),
);

const identity = (x: number, y: number): [number, number] => [x, y];

function makeTileset(): RasterTileset2D {
  return new RasterTileset2D(
    { getTileData: () => new Promise(() => {}) } as Tileset2DProps,
    new TileMatrixSetAdaptor(WEB_MERCATOR_QUAD, {
      projectTo4326: identity,
      projectFrom4326: identity,
      projectTo3857: identity,
      projectFrom3857: identity,
    }),
  );
}

/**
 * The first and last few tile indices along one axis of a level `size` tiles
 * across. The float error in `getParentIndex`'s quotient grows with the index,
 * so the last tiles are where a tolerance runs out first. Checking every tile
 * of all 25 levels takes most of a second.
 */
function edgeIndices(size: number): number[] {
  const count = Math.min(size, 8);
  const first = Array.from({ length: count }, (_, i) => i);
  const last = first.map((i) => size - count + i);
  return [...first, ...last];
}

describe("RasterTileset2D.getParentIndex with rounded scale denominators", () => {
  it("maps 9/2/1 to 8/1/0", () => {
    const tileset = makeTileset();
    expect(tileset.getParentIndex({ x: 2, y: 1, z: 9 })).toEqual({
      x: 1,
      y: 0,
      z: 8,
    });
  });

  it("maps the first and last tiles of every level to the parents that contain them", () => {
    const tileset = makeTileset();
    for (let z = 1; z < WEB_MERCATOR_QUAD.tileMatrices.length; z++) {
      for (const i of edgeIndices(2 ** z)) {
        expect(tileset.getParentIndex({ x: i, y: i, z })).toEqual({
          x: Math.floor(i / 2),
          y: Math.floor(i / 2),
          z: z - 1,
        });
      }
    }
  });
});
