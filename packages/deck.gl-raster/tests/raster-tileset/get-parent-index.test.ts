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

// The overview widths of the "Umbra Port of Rotterdam" COG in
// examples/cog-basic (512px tiles), which GDAL sized by halving and rounding
// down. Every level spans the same extent, so when a width is odd the next
// level is slightly more than 2x coarser: 2857 -> 1428 px gives a decimation
// of 2857 / 1428 = 2.0007, far beyond what TILE_EDGE_TOLERANCE absorbs.
const OVERVIEW_WIDTHS = [357, 714, 1428, 2857, 5714, 11429, 22859];
// A 2049px COG halved the same way. Its last tile holds one column of data,
// and the center of that tile lies past the edge of the 1024px level.
const SLIVER_WIDTHS = [512, 1024, 2049];
const TILE_SIZE = 512;
const SCREEN_PIXEL_SIZE = 0.00028;

/** A tileset whose levels have these widths and all span the same extent. */
function makeOverviewTileset(widths: number[]): RasterTileset2D {
  const extent = widths.at(-1)!; // arbitrary: 1m pixels at full resolution
  const tms: TileMatrixSet = {
    id: "rounded-overviews",
    crs: { uri: "http://www.opengis.net/def/crs/EPSG/0/3857" },
    boundingBox: { lowerLeft: [0, -extent], upperRight: [extent, 0] },
    tileMatrices: widths.map((width, z) => {
      const cellSize = extent / width;
      return {
        id: String(z),
        scaleDenominator: cellSize / SCREEN_PIXEL_SIZE,
        cellSize,
        cornerOfOrigin: "topLeft" as const,
        pointOfOrigin: [0, 0],
        tileWidth: TILE_SIZE,
        tileHeight: TILE_SIZE,
        matrixWidth: Math.ceil(width / TILE_SIZE),
        matrixHeight: Math.ceil(width / TILE_SIZE),
      };
    }),
  };
  return new RasterTileset2D(
    { getTileData: () => new Promise(() => {}) } as Tileset2DProps,
    new TileMatrixSetAdaptor(tms, {
      projectTo4326: identity,
      projectFrom4326: identity,
      projectTo3857: identity,
      projectFrom3857: identity,
    }),
  );
}

/**
 * The tile of a `parentWidth` level that holds most of the data of tile `i`
 * of a `childWidth` level, along one axis. Both levels span the same extent.
 */
function mostOverlappingParent(
  i: number,
  childWidth: number,
  parentWidth: number,
): number {
  const scale = parentWidth / childWidth;
  const start = i * TILE_SIZE * scale;
  const end = Math.min((i + 1) * TILE_SIZE, childWidth) * scale;
  const overlap = (p: number) =>
    Math.min(end, (p + 1) * TILE_SIZE) - Math.max(start, p * TILE_SIZE);
  let best = 0;
  for (let p = 1; p < Math.ceil(parentWidth / TILE_SIZE); p++) {
    if (overlap(p) > overlap(best)) {
      best = p;
    }
  }
  return best;
}

describe("RasterTileset2D.getParentIndex with rounded-down overview sizes", () => {
  it("maps 3/2/2 (2857px level) to 2/1/1 (1428px level), not its neighbor", () => {
    const tileset = makeOverviewTileset(OVERVIEW_WIDTHS);
    expect(tileset.getParentIndex({ x: 2, y: 2, z: 3 })).toEqual({
      x: 1,
      y: 1,
      z: 2,
    });
  });

  it("maps the last tile of a 2049px level to the last 1024px tile", () => {
    const tileset = makeOverviewTileset(SLIVER_WIDTHS);
    expect(tileset.getParentIndex({ x: 4, y: 4, z: 2 })).toEqual({
      x: 1,
      y: 1,
      z: 1,
    });
  });

  it.each([
    ["the Umbra COG", OVERVIEW_WIDTHS],
    ["a 2049px COG", SLIVER_WIDTHS],
  ])(
    "maps every tile of %s to the parent holding most of its data",
    (_, widths) => {
      const tileset = makeOverviewTileset(widths);
      for (let z = 1; z < widths.length; z++) {
        for (const i of edgeIndices(Math.ceil(widths[z]! / TILE_SIZE))) {
          const parent = mostOverlappingParent(i, widths[z]!, widths[z - 1]!);
          expect(
            tileset.getParentIndex({ x: i, y: i, z }),
            `z=${z} index=${i}`,
          ).toEqual({ x: parent, y: parent, z: z - 1 });
        }
      }
    },
  );
});
