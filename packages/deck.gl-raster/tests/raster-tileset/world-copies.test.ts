import { _GlobeViewport, WebMercatorViewport } from "@deck.gl/core";
import { CullingVolume, Plane } from "@math.gl/culling";
import { lngLatToWorld } from "@math.gl/web-mercator";
import { describe, expect, it } from "vitest";
import { BoundingVolumeCache } from "../../src/raster-tileset/bounding-volume-cache.js";
import {
  getTileIndices,
  RasterTileNode,
} from "../../src/raster-tileset/raster-tile-traversal.js";
import type {
  RasterTilesetDescriptor,
  RasterTilesetLevel,
} from "../../src/raster-tileset/tileset-interface.js";
import type { Bounds, Corners } from "../../src/raster-tileset/types.js";

const TILE_SIZE = 512;

// Identity projections — source CRS treated as EPSG:4326 == EPSG:3857 within
// the small geometric range these tests exercise.
const identity = (x: number, y: number): [number, number] => [x, y];

function makeLevel(opts: { corners: Corners }): RasterTilesetLevel {
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

function makeDescriptor(corners: Corners): RasterTilesetDescriptor {
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
    const cache = new BoundingVolumeCache();
    const { boundingVolume, commonSpaceBounds } = node.getBoundingVolume(
      [0, 0],
      null,
      cache,
      0,
    );
    expect(commonSpaceBounds[0]).toBeGreaterThan(0);
    expect(commonSpaceBounds[2]).toBeLessThan(TILE_SIZE);
    expect(boundingVolume.center[0]).toBeGreaterThan(0);
    expect(boundingVolume.center[0]).toBeLessThan(TILE_SIZE);
  });

  it("worldOffset=+1 shifts AABB and OBB center by +TILE_SIZE in X", () => {
    const node = new RasterTileNode(0, 0, 0, { descriptor });
    const cache = new BoundingVolumeCache();
    const { boundingVolume: bv0, commonSpaceBounds: aabb0 } =
      node.getBoundingVolume([0, 0], null, cache, 0);
    const { boundingVolume: bv1, commonSpaceBounds: aabb1 } =
      node.getBoundingVolume([0, 0], null, cache, 1);

    expect(aabb1[0]).toBeCloseTo(aabb0[0] + TILE_SIZE, 6);
    expect(aabb1[2]).toBeCloseTo(aabb0[2] + TILE_SIZE, 6);
    // Y bounds unchanged
    expect(aabb1[1]).toBeCloseTo(aabb0[1], 6);
    expect(aabb1[3]).toBeCloseTo(aabb0[3], 6);

    expect(bv1.center[0]!).toBeCloseTo(bv0.center[0]! + TILE_SIZE, 6);
    expect(bv1.center[1]!).toBeCloseTo(bv0.center[1]!, 6);
  });

  it("worldOffset=-2 shifts AABB and OBB center by -2*TILE_SIZE in X", () => {
    const node = new RasterTileNode(0, 0, 0, { descriptor });
    const cache = new BoundingVolumeCache();
    const { boundingVolume: bv0, commonSpaceBounds: aabb0 } =
      node.getBoundingVolume([0, 0], null, cache, 0);
    const { boundingVolume: bv2, commonSpaceBounds: aabb2 } =
      node.getBoundingVolume([0, 0], null, cache, -2);

    expect(aabb2[0]).toBeCloseTo(aabb0[0] - 2 * TILE_SIZE, 6);
    expect(aabb2[2]).toBeCloseTo(aabb0[2] - 2 * TILE_SIZE, 6);
    expect(bv2.center[0]!).toBeCloseTo(bv0.center[0]! - 2 * TILE_SIZE, 6);
  });

  it("does not mutate the cached offset-0 result when called with non-zero offsets", () => {
    const node = new RasterTileNode(0, 0, 0, { descriptor });
    const cache = new BoundingVolumeCache();
    const before = node.getBoundingVolume([0, 0], null, cache, 0);
    const beforeAabb: readonly number[] = [...before.commonSpaceBounds];
    const beforeCenterX = before.boundingVolume.center[0];

    node.getBoundingVolume([0, 0], null, cache, 3);

    const after = node.getBoundingVolume([0, 0], null, cache, 0);
    expect(after.commonSpaceBounds).toEqual(beforeAabb);
    expect(after.boundingVolume.center[0]!).toBeCloseTo(beforeCenterX!, 12);
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
      boundingVolumeCache: new BoundingVolumeCache(),
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

// Convert (lng, lat) in WGS84 to EPSG:3857 meters. The traversal expects
// `projectTo3857` to return EPSG:3857 meters, which is what the
// `rescaleEPSG3857ToCommonSpace` step then re-scales into deck.gl common
// space (0..512). The `lod-pixel-ratio.test.ts` identity-projection trick
// only works for tiny coordinates near (0, 0); these tests place the
// dataset away from origin so a real WGS84→3857 conversion is required.
const WGS84_RADIUS = 6378137;
function wgs84To3857(lng: number, lat: number): [number, number] {
  const x = (lng * Math.PI * WGS84_RADIUS) / 180;
  const y =
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * WGS84_RADIUS;
  return [x, y];
}
function epsg3857ToWgs84(x: number, y: number): [number, number] {
  const lng = (x * 180) / (Math.PI * WGS84_RADIUS);
  const lat = (Math.atan(Math.exp(y / WGS84_RADIUS)) * 360) / Math.PI - 90;
  return [lng, lat];
}

function makeWgs84Descriptor(opts: {
  corners: Corners;
}): RasterTilesetDescriptor {
  // Corners are stored in EPSG:3857 meters here (so projectedTileCorners
  // returns 3857). projectTo3857 is then identity, projectTo4326 converts.
  const corners = opts.corners;
  return {
    levels: [
      {
        matrixWidth: 1,
        matrixHeight: 1,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 1,
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
      },
    ],
    projectTo3857: (x, y) => [x, y],
    projectTo4326: epsg3857ToWgs84,
    projectFrom3857: (x, y) => [x, y],
    projectFrom4326: wgs84To3857,
    projectedBounds: [
      Math.min(corners.topLeft[0], corners.bottomRight[0]),
      Math.min(corners.topLeft[1], corners.bottomRight[1]),
      Math.max(corners.topLeft[0], corners.bottomRight[0]),
      Math.max(corners.topLeft[1], corners.bottomRight[1]),
    ],
  };
}

function cornersFromWgs84(
  west: number,
  south: number,
  east: number,
  north: number,
): Corners {
  const tl = wgs84To3857(west, north);
  const tr = wgs84To3857(east, north);
  const bl = wgs84To3857(west, south);
  const br = wgs84To3857(east, south);
  return { topLeft: tl, topRight: tr, bottomLeft: bl, bottomRight: br };
}

describe("getTileIndices — multi-world copy traversal", () => {
  // Dataset just west of the antimeridian (lng [170, 180]).
  const westOfAntimeridianCorners = cornersFromWgs84(170, -10, 180, 10);
  const westOfAntimeridianBounds: Bounds = [170, -10, 180, 10];
  const westOfAntimeridianDescriptor = makeWgs84Descriptor({
    corners: westOfAntimeridianCorners,
  });

  // Dataset just east of the antimeridian (lng [-180, -170]).
  const eastOfAntimeridianCorners = cornersFromWgs84(-180, -10, -170, 10);
  const eastOfAntimeridianBounds: Bounds = [-180, -10, -170, 10];
  const eastOfAntimeridianDescriptor = makeWgs84Descriptor({
    corners: eastOfAntimeridianCorners,
  });

  // Centered dataset (lng [-10, 10]) for parity tests.
  const centeredCorners = cornersFromWgs84(-10, -10, 10, 10);
  const centeredBounds: Bounds = [-10, -10, 10, 10];
  const centeredDescriptor = makeWgs84Descriptor({
    corners: centeredCorners,
  });

  it("camera east of antimeridian sees dataset west of antimeridian via offset-1 (single-world traversal would miss it)", () => {
    // Camera at lng=-179, zoom=4. Bounds straddle the antimeridian
    // (~[-190, -168]) → subViewports.length === 2. The dataset's offset-0
    // position (common-space x ≈ [497, 512]) is far outside the frustum
    // (which is near x=0 / x=512 wrap). Only the offset-1 traversal places
    // the dataset's translated AABB (x ≈ [-15, 0]) in the frustum.
    const viewport = new WebMercatorViewport({
      longitude: -179,
      latitude: 0,
      zoom: 4,
      width: 400,
      height: 400,
      repeat: true,
    });
    expect(viewport.subViewports?.length ?? 0).toBeGreaterThan(1);

    const indices = getTileIndices(westOfAntimeridianDescriptor, {
      viewport,
      maxZ: 0,
      zRange: null,
      wgs84Bounds: westOfAntimeridianBounds,
    });
    expect(indices.length).toBeGreaterThan(0);
  });

  it("camera west of antimeridian sees dataset east of antimeridian via offset+1", () => {
    // Mirror of the previous test (camera at lng=179; the dataset's offset-0
    // x ≈ [0, 15] enters the frustum only when translated by offset+1).
    const viewport = new WebMercatorViewport({
      longitude: 179,
      latitude: 0,
      zoom: 4,
      width: 400,
      height: 400,
      repeat: true,
    });
    expect(viewport.subViewports?.length ?? 0).toBeGreaterThan(1);

    const indices = getTileIndices(eastOfAntimeridianDescriptor, {
      viewport,
      maxZ: 0,
      zRange: null,
      wgs84Bounds: eastOfAntimeridianBounds,
    });
    expect(indices.length).toBeGreaterThan(0);
  });

  it("centered viewport returns a non-empty selection (parity baseline)", () => {
    const viewport = new WebMercatorViewport({
      longitude: 0,
      latitude: 0,
      zoom: 4,
      width: 400,
      height: 400,
    });
    const indices = getTileIndices(centeredDescriptor, {
      viewport,
      maxZ: 0,
      zRange: null,
      wgs84Bounds: centeredBounds,
    });
    expect(indices.length).toBeGreaterThan(0);
  });

  it("single-world parity: subViewports==null path returns the same selection as before the multi-world wiring", () => {
    // repeat: false → subViewports is null. This is a snapshot of pre-fix
    // behavior; if this test ever changes, it indicates we accidentally
    // perturbed the offset-0 selection.
    const viewport = new WebMercatorViewport({
      longitude: 0,
      latitude: 0,
      zoom: 4,
      width: 400,
      height: 400,
    });
    expect(viewport.subViewports).toBeNull();

    const indices = getTileIndices(centeredDescriptor, {
      viewport,
      maxZ: 0,
      zRange: null,
      wgs84Bounds: centeredBounds,
    });
    // Single root tile descriptor → exactly 1 selected tile at this zoom.
    expect(indices).toHaveLength(1);
    expect(indices[0]).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it("subViewports.length === 1 (narrow repeat:true viewport) does not run extra passes", () => {
    // repeat: true with longitude/zoom that doesn't cross the antimeridian:
    // subViewports populates with exactly one entry, so the multi-world
    // branch must not fire. Selection should match the single-world case.
    const viewport = new WebMercatorViewport({
      longitude: 0,
      latitude: 0,
      zoom: 4,
      width: 200,
      height: 200,
      repeat: true,
    });
    expect(viewport.subViewports?.length).toBe(1);

    const indices = getTileIndices(centeredDescriptor, {
      viewport,
      maxZ: 0,
      zRange: null,
      wgs84Bounds: centeredBounds,
    });
    expect(indices).toHaveLength(1);
    expect(indices[0]).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it("Globe view: subViewports is null, so the multi-world branch is gated off", () => {
    // We don't call getTileIndices here because Globe view currently asserts
    // in getBoundingVolume (the assert(false, "TODO: implement getBoundingVolume
    // in Globe view") path). What this test actually protects: the activation
    // gate is `viewport.subViewports?.length > 1`, and `_GlobeViewport` does
    // not expose subViewports. If deck.gl ever wires it up this assumption
    // breaks and this test goes red.
    const globe = new _GlobeViewport({
      longitude: 0,
      latitude: 0,
      zoom: 1,
      width: 400,
      height: 400,
    });
    expect(globe.subViewports).toBeNull();
  });

  it("MAX_MAPS cap: extreme zoom-out terminates without infinite loop", () => {
    // zoom=0 with a 4000px-wide canvas → bounds span > 360° many times over,
    // so subViewports.length is ~9. Without the MAX_MAPS cap the eastward
    // and westward walks would not terminate on "no visible tiles" until
    // they ran far further than necessary.
    const viewport = new WebMercatorViewport({
      longitude: 0,
      latitude: 0,
      zoom: 0,
      width: 4000,
      height: 1000,
      repeat: true,
    });
    expect((viewport.subViewports?.length ?? 0) > 1).toBe(true);

    const start = performance.now();
    const indices = getTileIndices(centeredDescriptor, {
      viewport,
      maxZ: 0,
      zRange: null,
      wgs84Bounds: centeredBounds,
    });
    const elapsed = performance.now() - start;

    expect(indices.length).toBeGreaterThan(0);
    // 1s is generous for a single-root traversal — guards against runaway loops.
    expect(elapsed).toBeLessThan(1000);
  });
});
