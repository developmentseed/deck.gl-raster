import { _GlobeViewport as GlobeViewport } from "@deck.gl/core";
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

function makeGlobeViewport(zoom = 1): GlobeViewport {
  return new GlobeViewport({
    width: 800,
    height: 600,
    longitude: 0,
    latitude: 0,
    zoom,
    resolution: 10,
  });
}

function maxSelectedZ(
  descriptor: RasterTilesetDescriptor,
  zoom: number,
  maxZ: number,
): number {
  const indices = getTileIndices(descriptor, {
    viewport: makeGlobeViewport(zoom),
    maxZ,
    zRange: null,
    wgs84Bounds: [-10, -10, 10, 10] as Bounds,
    pixelRatio: 1,
  });
  return Math.max(...indices.map((i) => i.z));
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

  it("picks coarser levels when zoomed out (LOD tracks zoom, not the finest level)", () => {
    // metersPerPixel per level, halving from coarse (z0) to fine (z5). At a low
    // globe zoom the screen resolution is coarse, so a coarse level suffices;
    // zooming in should select progressively finer levels. The bug drove the
    // LOD latitude from the 3D OBB center (globe-common space → ~-89° garbage),
    // making meters/px far too small so the traversal always recursed to maxZ.
    const metersPerPixel = [78000, 39000, 19500, 9750, 4875, 2437];
    const maxZ = metersPerPixel.length - 1; // 5
    const descriptor = makeDescriptor(metersPerPixel);

    const zoomedOut = maxSelectedZ(descriptor, 1, maxZ);
    const zoomedIn = maxSelectedZ(descriptor, 6, maxZ);

    // Zoomed out must NOT load the finest level across the globe.
    expect(zoomedOut).toBeLessThan(maxZ);
    // Zooming in selects strictly finer tiles.
    expect(zoomedOut).toBeLessThan(zoomedIn);
  });

  it("selects a tile whose grid footprint extends past a pole", () => {
    // A global EPSG:4326 COG overview smaller than one tile (512x256 pixels in
    // a 512x512 tile) has a tile footprint whose bottom edge sits at -270°.
    const corners: Corners = {
      topLeft: [-180, 90],
      topRight: [180, 90],
      bottomLeft: [-180, -270],
      bottomRight: [180, -270],
    };
    const descriptor: RasterTilesetDescriptor = {
      levels: [{ ...makeLevel(78000), projectedTileCorners: () => corners }],
      projectTo3857: identity,
      projectTo4326: identity,
      projectFrom3857: identity,
      projectFrom4326: identity,
      projectedBounds: [-180, -90, 180, 90],
    };

    const indices = getTileIndices(descriptor, {
      viewport: makeGlobeViewport(),
      maxZ: 0,
      zRange: null,
      wgs84Bounds: [-180, -85.0511287798066, 180, 85.0511287798066],
      pixelRatio: 1,
    });
    expect(indices).toHaveLength(1);
  });
});
