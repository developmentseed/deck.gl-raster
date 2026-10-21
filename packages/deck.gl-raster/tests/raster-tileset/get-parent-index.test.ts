import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import type { TileMatrix, TileMatrixSet } from "@developmentseed/morecantile";
import { describe, expect, it } from "vitest";
import { RasterTileset2D } from "../../src/raster-tileset/raster-tileset-2d.js";
import { TileMatrixSetAdaptor } from "../../src/raster-tileset/tile-matrix-set.js";

const identity = (x: number, y: number): [number, number] => [x, y];

const ORIGIN = 20037508.3427892;

// Rounded scale denominators from the OGC example WebMercatorQuad. The ratio
// between consecutive levels comes out slightly above 2 for some pairs, e.g.
// z8 / z9 = 2.000000000000009 and z7 / z8 = 2.0000000000000044.
const SCALE_DENOMINATORS: Record<number, number> = {
  6: 8735660.37544871,
  7: 4367830.18772435,
  8: 2183915.09386217,
  9: 1091957.54693108,
};

function tileMatrix(z: number): TileMatrix {
  const scaleDenominator = SCALE_DENOMINATORS[z]!;
  return {
    id: String(z),
    scaleDenominator,
    cellSize: scaleDenominator * 0.00028,
    cornerOfOrigin: "topLeft",
    pointOfOrigin: [-ORIGIN, ORIGIN],
    tileWidth: 256,
    tileHeight: 256,
    matrixWidth: 2 ** z,
    matrixHeight: 2 ** z,
  };
}

function makeTileset(zooms: number[]): RasterTileset2D {
  const tms: TileMatrixSet = {
    id: "WebMercatorQuad",
    crs: { uri: "http://www.opengis.net/def/crs/EPSG/0/3857" },
    boundingBox: {
      lowerLeft: [-ORIGIN, -ORIGIN],
      upperRight: [ORIGIN, ORIGIN],
    },
    tileMatrices: zooms.map(tileMatrix),
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

describe("RasterTileset2D.getParentIndex with rounded scale denominators", () => {
  it("maps 9/2/1 to 8/1/0", () => {
    const tileset = makeTileset([8, 9]);
    expect(tileset.getParentIndex({ x: 2, y: 1, z: 1 })).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
  });

  it("maps every tile to the parent that contains it", () => {
    const zooms = [6, 7, 8, 9];
    const tileset = makeTileset(zooms);
    for (let z = 1; z < zooms.length; z++) {
      const size = 2 ** zooms[z]!;
      for (let i = 0; i < size; i++) {
        const parent = tileset.getParentIndex({ x: i, y: size - 1 - i, z });
        expect(parent).toEqual({
          x: Math.floor(i / 2),
          y: Math.floor((size - 1 - i) / 2),
          z: z - 1,
        });
      }
    }
  });
});
