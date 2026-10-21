import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import { describe, expect, it } from "vitest";
import { TileMatrixSetAdaptor } from "../../src/raster-tileset/tile-matrix-set.js";

// The OGC TMS 2.0 example WebMercatorQuad. Like the TileMatrixSets in Python
// morecantile's registry, it omits the optional `boundingBox`.
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

const PROJECTIONS = {
  projectTo3857: identity,
  projectFrom3857: identity,
  projectTo4326: identity,
  projectFrom4326: identity,
};

describe("TileMatrixSetAdaptor.projectedBounds", () => {
  it("infers WebMercatorQuad's bounds when boundingBox is missing", () => {
    expect(WEB_MERCATOR_QUAD.boundingBox).toBeUndefined();
    const adaptor = new TileMatrixSetAdaptor(WEB_MERCATOR_QUAD, PROJECTIONS);

    // The coarsest matrix is one 256 px tile at 156543.033928041 m/px, hanging
    // down and right from the top-left pointOfOrigin: the whole Mercator world.
    const [minX, minY, maxX, maxY] = adaptor.projectedBounds;
    expect(minX).toBeCloseTo(-20037508.3427892, 6);
    expect(minY).toBeCloseTo(-20037508.3427892, 6);
    expect(maxX).toBeCloseTo(20037508.3427892, 6);
    expect(maxY).toBeCloseTo(20037508.3427892, 6);
  });

  it("uses an explicit boundingBox unchanged", () => {
    // E.g. a TileMatrixSet generated for one COG, whose bounds are tighter
    // than its tile grid.
    const tms: TileMatrixSet = {
      ...WEB_MERCATOR_QUAD,
      boundingBox: {
        lowerLeft: [-1000000, -2000000],
        upperRight: [3000000, 4000000],
      },
    };
    const adaptor = new TileMatrixSetAdaptor(tms, PROJECTIONS);
    expect(adaptor.projectedBounds).toEqual([
      -1000000, -2000000, 3000000, 4000000,
    ]);
  });

  it("infers bounds for a bottomLeft cornerOfOrigin without boundingBox", () => {
    // 3 × 2 tiles of 10 × 10 px at 1 unit/px, numbered up and to the right
    // from the bottom-left pointOfOrigin (100, 200): 30 × 20 units in all.
    const tms: TileMatrixSet = {
      id: "bottom-left",
      crs: { uri: "http://www.opengis.net/def/crs/EPSG/0/3857" },
      tileMatrices: [
        {
          id: "0",
          scaleDenominator: 1000,
          cellSize: 1,
          cornerOfOrigin: "bottomLeft",
          pointOfOrigin: [100, 200],
          tileWidth: 10,
          tileHeight: 10,
          matrixWidth: 3,
          matrixHeight: 2,
        },
      ],
    };
    const adaptor = new TileMatrixSetAdaptor(tms, PROJECTIONS);
    expect(adaptor.projectedBounds).toEqual([100, 200, 130, 220]);
  });
});
