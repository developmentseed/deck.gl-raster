import { _GlobeViewport } from "@deck.gl/core";
import { describe, expect, it } from "vitest";
import { getTileIndices } from "../../src/raster-tileset/raster-tile-traversal.js";
import type {
  RasterTilesetDescriptor,
  RasterTilesetLevel,
} from "../../src/raster-tileset/tileset-interface.js";
import type { Bounds, Corners } from "../../src/raster-tileset/types.js";

const identity = (x: number, y: number): [number, number] => [x, y];

/** Single-tile level covering the lng/lat box [-10, -10, 10, 10]. */
function makeLevel(metersPerPixel: number): RasterTilesetLevel {
  const corners: Corners = {
    topLeft: [-10, 10],
    topRight: [10, 10],
    bottomLeft: [-10, -10],
    bottomRight: [10, -10],
  };
  return {
    matrixWidth: 1,
    matrixHeight: 1,
    tileWidth: 256,
    tileHeight: 256,
    metersPerPixel,
    projectedTileCorners: () => corners,
    tileTransform: () => {
      throw new Error("not used");
    },
    crsBoundsToTileRange: () => ({
      minCol: 0,
      maxCol: 0,
      minRow: 0,
      maxRow: 0,
    }),
  };
}

/** Descriptor whose source CRS is WGS84 (identity projections). */
function makeDescriptor(
  metersPerPixelByLevel: number[],
): RasterTilesetDescriptor {
  return {
    levels: metersPerPixelByLevel.map(makeLevel),
    projectTo3857: identity,
    projectTo4326: identity,
    projectFrom3857: identity,
    projectFrom4326: identity,
    projectedBounds: [-10, -10, 10, 10],
  };
}

function makeGlobeViewport(): _GlobeViewport {
  return new _GlobeViewport({
    width: 200,
    height: 200,
    longitude: 0,
    latitude: 0,
    zoom: 1,
    resolution: 10,
  });
}

describe("getTileIndices: GlobeView", () => {
  it("selects tiles in a GlobeView without throwing", () => {
    const descriptor = makeDescriptor([1.0, 0.4, 0.1]);
    const viewport = makeGlobeViewport();
    const indices = getTileIndices(descriptor, {
      viewport,
      maxZ: 2,
      zRange: null,
      wgs84Bounds: [-10, -10, 10, 10] as Bounds,
      pixelRatio: 1,
    });
    expect(indices.length).toBeGreaterThan(0);
  });
});
