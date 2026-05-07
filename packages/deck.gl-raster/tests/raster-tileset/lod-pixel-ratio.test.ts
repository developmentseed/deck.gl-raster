import { WebMercatorViewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { describe, expect, it } from "vitest";
import { RasterTileset2D } from "../../src/raster-tileset/raster-tileset-2d.js";
import type {
  TilesetDescriptor,
  TilesetLevel,
} from "../../src/raster-tileset/tileset-interface.js";
import type { Corners } from "../../src/raster-tileset/types.js";

// Identity projection — source CRS is treated as EPSG:4326 == EPSG:3857
// for the limited geometric range the test covers.
const identity = (x: number, y: number): [number, number] => [x, y];

/**
 * Single-tile level covering [-1, -1, 1, 1] in source CRS, with caller-
 * specified `metersPerPixel`.
 */
function makeLevel(metersPerPixel: number): TilesetLevel {
  const corners: Corners = {
    topLeft: [-1, 1],
    topRight: [1, 1],
    bottomLeft: [-1, -1],
    bottomRight: [1, -1],
  };
  return {
    matrixWidth: 1,
    matrixHeight: 1,
    tileWidth: 256,
    tileHeight: 256,
    metersPerPixel,
    projectedTileCorners: () => corners,
    tileTransform: () => {
      throw new Error("not used in this test");
    },
    crsBoundsToTileRange: () => ({
      minCol: 0,
      maxCol: 0,
      minRow: 0,
      maxRow: 0,
    }),
  };
}

function makeDescriptor(metersPerPixelByLevel: number[]): TilesetDescriptor {
  return {
    levels: metersPerPixelByLevel.map(makeLevel),
    projectTo3857: identity,
    projectTo4326: identity,
    projectFrom3857: identity,
    projectFrom4326: identity,
    projectedBounds: [-1, -1, 1, 1],
  };
}

function makeViewport(): WebMercatorViewport {
  // zoom=18, lat=0 → metersPerScreenPixel ≈ 0.597 m
  return new WebMercatorViewport({
    longitude: 0,
    latitude: 0,
    zoom: 18,
    width: 100,
    height: 100,
  });
}

describe("LOD selection: pixelRatio threading", () => {
  // Levels chosen so metersPerScreenPixel ≈ 0.597 lands between z=1 and z=2:
  //   z=0 mpp = 1.0   (always too coarse for this view)
  //   z=1 mpp = 0.4   (sufficient at dpr=1; insufficient at dpr=2 since 0.4*2 > 0.597)
  //   z=2 mpp = 0.1   (always sufficient)
  const descriptor = makeDescriptor([1.0, 0.4, 0.1]);

  function getSelectedZ(pixelRatio: number): number[] {
    const tileset = new RasterTileset2D(
      {
        getTileData: () => new Promise(() => {}),
      } as Tileset2DProps,
      descriptor,
      { getPixelRatio: () => pixelRatio },
    );
    const indices = tileset.getTileIndices({
      viewport: makeViewport(),
      zRange: null,
    });
    return indices.map((idx) => idx.z);
  }

  it("selects intermediate level z=1 at pixelRatio=1", () => {
    expect(getSelectedZ(1)).toEqual([1]);
  });

  it("selects finer level z=2 at pixelRatio=2 (HiDPI display)", () => {
    expect(getSelectedZ(2)).toEqual([2]);
  });
});
