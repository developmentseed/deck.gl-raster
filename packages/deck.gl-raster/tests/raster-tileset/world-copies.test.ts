import { WebMercatorViewport } from "@deck.gl/core";
import { CullingVolume, Plane } from "@math.gl/culling";
import { lngLatToWorld } from "@math.gl/web-mercator";
import { describe, expect, it } from "vitest";
import { RasterTileNode } from "../../src/raster-tileset/raster-tile-traversal.js";
import type {
  TilesetDescriptor,
  TilesetLevel,
} from "../../src/raster-tileset/tileset-interface.js";
import type { Corners } from "../../src/raster-tileset/types.js";

const TILE_SIZE = 512;

// Identity projections — source CRS treated as EPSG:4326 == EPSG:3857 within
// the small geometric range these tests exercise.
const identity = (x: number, y: number): [number, number] => [x, y];

function makeLevel(opts: { corners: Corners }): TilesetLevel {
  return {
    matrixWidth: 1,
    matrixHeight: 1,
    tileWidth: 256,
    tileHeight: 256,
    metersPerPixel: 1,
    projectedTileCorners: () => opts.corners,
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

function makeDescriptor(corners: Corners): TilesetDescriptor {
  return {
    levels: [makeLevel({ corners })],
    projectTo3857: identity,
    projectTo4326: identity,
    projectFrom3857: identity,
    projectFrom4326: identity,
    projectedBounds: [
      Math.min(corners.topLeft[0], corners.bottomRight[0]),
      Math.min(corners.topLeft[1], corners.bottomRight[1]),
      Math.max(corners.topLeft[0], corners.bottomRight[0]),
      Math.max(corners.topLeft[1], corners.bottomRight[1]),
    ],
  };
}

describe("RasterTileNode.getBoundingVolume — worldOffset translation", () => {
  // Tile spans [-1, -1, 1, 1] in source CRS. With identity projections this
  // produces a small commonSpaceBounds AABB centered near (256, 256) in
  // deck.gl common space (0..512).
  const corners: Corners = {
    topLeft: [-1, 1],
    topRight: [1, 1],
    bottomLeft: [-1, -1],
    bottomRight: [1, -1],
  };
  const descriptor = makeDescriptor(corners);

  it("offset=0 returns the un-translated OBB and AABB", () => {
    const node = new RasterTileNode(0, 0, 0, { descriptor });
    const { boundingVolume, commonSpaceBounds } = node.getBoundingVolume(
      [0, 0],
      null,
      0,
    );
    expect(commonSpaceBounds[0]).toBeGreaterThan(0);
    expect(commonSpaceBounds[2]).toBeLessThan(TILE_SIZE);
    expect(boundingVolume.center[0]).toBeGreaterThan(0);
    expect(boundingVolume.center[0]).toBeLessThan(TILE_SIZE);
  });

  it("worldOffset=+1 shifts AABB and OBB center by +TILE_SIZE in X", () => {
    const node = new RasterTileNode(0, 0, 0, { descriptor });
    const { boundingVolume: bv0, commonSpaceBounds: aabb0 } =
      node.getBoundingVolume([0, 0], null, 0);
    const { boundingVolume: bv1, commonSpaceBounds: aabb1 } =
      node.getBoundingVolume([0, 0], null, 1);

    expect(aabb1[0]).toBeCloseTo(aabb0[0] + TILE_SIZE, 6);
    expect(aabb1[2]).toBeCloseTo(aabb0[2] + TILE_SIZE, 6);
    // Y bounds unchanged
    expect(aabb1[1]).toBeCloseTo(aabb0[1], 6);
    expect(aabb1[3]).toBeCloseTo(aabb0[3], 6);

    expect(bv1.center[0]).toBeCloseTo(bv0.center[0] + TILE_SIZE, 6);
    expect(bv1.center[1]).toBeCloseTo(bv0.center[1], 6);
  });

  it("worldOffset=-2 shifts AABB and OBB center by -2*TILE_SIZE in X", () => {
    const node = new RasterTileNode(0, 0, 0, { descriptor });
    const { boundingVolume: bv0, commonSpaceBounds: aabb0 } =
      node.getBoundingVolume([0, 0], null, 0);
    const { boundingVolume: bv2, commonSpaceBounds: aabb2 } =
      node.getBoundingVolume([0, 0], null, -2);

    expect(aabb2[0]).toBeCloseTo(aabb0[0] - 2 * TILE_SIZE, 6);
    expect(aabb2[2]).toBeCloseTo(aabb0[2] - 2 * TILE_SIZE, 6);
    expect(bv2.center[0]).toBeCloseTo(bv0.center[0] - 2 * TILE_SIZE, 6);
  });

  it("does not mutate the cached offset-0 result when called with non-zero offsets", () => {
    const node = new RasterTileNode(0, 0, 0, { descriptor });
    const before = node.getBoundingVolume([0, 0], null, 0);
    const beforeAabb: readonly number[] = [...before.commonSpaceBounds];
    const beforeCenterX = before.boundingVolume.center[0];

    node.getBoundingVolume([0, 0], null, 3);

    const after = node.getBoundingVolume([0, 0], null, 0);
    expect(after.commonSpaceBounds).toEqual(beforeAabb);
    expect(after.boundingVolume.center[0]).toBeCloseTo(beforeCenterX, 12);
  });
});

function makeCullingVolume(viewport: WebMercatorViewport): CullingVolume {
  const planes = Object.values(viewport.getFrustumPlanes()).map(
    ({ normal, distance }) => new Plane(normal.clone().negate(), distance),
  );
  return new CullingVolume(planes);
}

function makeBoundsCommonSpace(
  west: number,
  south: number,
  east: number,
  north: number,
): [number, number, number, number] {
  const bl = lngLatToWorld([west, south]);
  const tr = lngLatToWorld([east, north]);
  return [bl[0], bl[1], tr[0], tr[1]];
}

describe("RasterTileNode.update — additive selection across worldOffset", () => {
  // Same descriptor as the bounding-volume tests but with a single root tile
  // covering [-1, -1, 1, 1] near (lng, lat) = (0, 0).
  const corners: Corners = {
    topLeft: [-1, 1],
    topRight: [1, 1],
    bottomLeft: [-1, -1],
    bottomRight: [1, -1],
  };
  const descriptor = makeDescriptor(corners);

  it("a tile selected at worldOffset=0 stays selected after a worldOffset=+1 pass that doesn't see it", () => {
    const node = new RasterTileNode(0, 0, 0, { descriptor });
    // Camera centered on (0, 0) — sees the dataset only at offset 0, not at
    // offset +1 (which would be at lng=360°).
    const viewport = new WebMercatorViewport({
      longitude: 0,
      latitude: 0,
      zoom: 5,
      width: 200,
      height: 200,
      repeat: true,
    });
    const cullingVolume = makeCullingVolume(viewport);
    const bounds = makeBoundsCommonSpace(-1, -1, 1, 1);

    const baseParams = {
      viewport,
      project: null,
      cullingVolume,
      elevationBounds: [0, 0] as [number, number],
      minZ: 0,
      maxZ: 0,
      bounds,
      pixelRatio: 1,
    };

    // Primary pass selects the tile.
    const visible0 = node.update({ ...baseParams, worldOffset: 0 });
    expect(visible0).toBe(true);
    // `getSelected()` walks the subtree returning nodes where `selected===true`.
    // For this single-tile descriptor it is exactly `[node]` when selected.
    expect(node.getSelected()).toHaveLength(1);

    // Offset +1 pass: tile is far outside the frustum at offset +1, so the
    // frustum check returns false. Selection from offset 0 must persist.
    const visible1 = node.update({ ...baseParams, worldOffset: 1 });
    expect(visible1).toBe(false);
    expect(node.getSelected()).toHaveLength(1);
  });
});
