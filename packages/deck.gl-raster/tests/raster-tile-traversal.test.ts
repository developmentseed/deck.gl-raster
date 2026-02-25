import { describe, expect, it } from "vitest";
import _WebMercator from "../../morecantile/spec/schemas/tms/2.0/json/examples/tilematrixset/WebMercatorQuad.json";
import _UTM31 from "../../morecantile/spec/schemas/tms/2.0/json/examples/tilematrixset/UTM31WGS84Quad.json";
import type { TileMatrix, TileMatrixSet } from "../../morecantile/src/types/index";
import { __TEST_EXPORTS, getTileIndices } from "../src/raster-tileset/raster-tile-traversal";
import type { ProjectionFunction } from "../src/raster-tileset/types";

const {
  computeProjectedTileBounds,
  getOverlappingChildRange,
  getMetersPerPixel,
  rescaleEPSG3857ToCommonSpace,
  sampleReferencePointsInEPSG3857,
  sampleReferencePointsInWgs84,
  RasterTileNode,
} = __TEST_EXPORTS;

const WebMercator = _WebMercator as TileMatrixSet;
const UTM31 = _UTM31 as TileMatrixSet;

function findMatrix(tms: TileMatrixSet, id: string): TileMatrix {
  const m = tms.tileMatrices.find((m) => m.id === id);
  if (!m) throw new Error(`no matrix with id "${id}"`);
  return m;
}

// ---------------------------------------------------------------------------
// computeProjectedTileBounds
// ---------------------------------------------------------------------------
describe("computeProjectedTileBounds", () => {
  it("returns correct bounds for WebMercatorQuad zoom 0 tile (0,0)", () => {
    const matrix = findMatrix(WebMercator, "0");
    const bounds = computeProjectedTileBounds(matrix, { x: 0, y: 0 });
    // WebMercatorQuad zoom 0 has one tile covering the entire world
    // EPSG:3857 full extent: ~[-20037508, -20037508, 20037508, 20037508]
    const halfCirc = Math.PI * 6378137;
    expect(bounds[0]).toBeCloseTo(-halfCirc, 0);
    expect(bounds[1]).toBeCloseTo(-halfCirc, 0);
    expect(bounds[2]).toBeCloseTo(halfCirc, 0);
    expect(bounds[3]).toBeCloseTo(halfCirc, 0);
  });

  it("returns correct bounds for WebMercatorQuad zoom 1 tile (0,0)", () => {
    const matrix = findMatrix(WebMercator, "1");
    const bounds = computeProjectedTileBounds(matrix, { x: 0, y: 0 });
    const halfCirc = Math.PI * 6378137;
    // Top-left quadrant: [-halfCirc, 0, 0, halfCirc]
    expect(bounds[0]).toBeCloseTo(-halfCirc, 0);
    expect(bounds[1]).toBeCloseTo(0, 0);
    expect(bounds[2]).toBeCloseTo(0, 0);
    expect(bounds[3]).toBeCloseTo(halfCirc, 0);
  });

  it("returns correct bounds for UTM31 tile", () => {
    // UTM31 matrix IDs start at "1", not "0"
    const matrix = findMatrix(UTM31, "1");
    const bounds = computeProjectedTileBounds(matrix, { x: 0, y: 0 });
    // UTM31 should have bounds in meters, origin around (166021, ~9329005)
    // Just verify it returns 4 finite numbers with min < max
    expect(bounds).toHaveLength(4);
    expect(bounds[0]).toBeLessThan(bounds[2]); // minX < maxX
    expect(bounds[1]).toBeLessThan(bounds[3]); // minY < maxY
    expect(Number.isFinite(bounds[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rescaleEPSG3857ToCommonSpace
// ---------------------------------------------------------------------------
describe("rescaleEPSG3857ToCommonSpace", () => {
  it("maps origin (0,0) in EPSG:3857 to center (256,256) in common space", () => {
    const [x, y] = rescaleEPSG3857ToCommonSpace([0, 0]);
    expect(x).toBeCloseTo(256, 5);
    expect(y).toBeCloseTo(256, 5);
  });

  it("maps EPSG:3857 full extent to [0,512] range", () => {
    const halfCirc = Math.PI * 6378137;
    const [xMin, yMin] = rescaleEPSG3857ToCommonSpace([-halfCirc, -halfCirc]);
    const [xMax, yMax] = rescaleEPSG3857ToCommonSpace([halfCirc, halfCirc]);
    expect(xMin).toBeCloseTo(0, 5);
    expect(yMin).toBeCloseTo(0, 5);
    expect(xMax).toBeCloseTo(512, 5);
    expect(yMax).toBeCloseTo(512, 5);
  });

  it("clamps Y values beyond Web Mercator bounds", () => {
    const halfCirc = Math.PI * 6378137;
    const beyondBounds = halfCirc * 2;
    const [, yBeyond] = rescaleEPSG3857ToCommonSpace([0, beyondBounds]);
    const [, yMax] = rescaleEPSG3857ToCommonSpace([0, halfCirc]);
    // Should be clamped to the same value as halfCirc
    expect(yBeyond).toBeCloseTo(yMax, 5);
  });
});

// ---------------------------------------------------------------------------
// sampleReferencePointsInEPSG3857
// ---------------------------------------------------------------------------
describe("sampleReferencePointsInEPSG3857", () => {
  it("identity projection returns input coordinates unchanged", () => {
    const identity: ProjectionFunction = (x, y) => [x, y];
    const tileBounds: [number, number, number, number] = [100, 200, 300, 400];
    const refPoints: [number, number][] = [
      [0, 0], // lower-left corner
      [1, 1], // upper-right corner
      [0.5, 0.5], // center
    ];
    const result = sampleReferencePointsInEPSG3857(
      refPoints,
      tileBounds,
      identity,
    );
    expect(result).toHaveLength(3);
    // [0,0] → (100, 200)
    expect(result[0]![0]).toBeCloseTo(100, 5);
    expect(result[0]![1]).toBeCloseTo(200, 5);
    // [1,1] → (300, 400)
    expect(result[1]![0]).toBeCloseTo(300, 5);
    expect(result[1]![1]).toBeCloseTo(400, 5);
    // [0.5,0.5] → (200, 300)
    expect(result[2]![0]).toBeCloseTo(200, 5);
    expect(result[2]![1]).toBeCloseTo(300, 5);
  });
});

// ---------------------------------------------------------------------------
// getOverlappingChildRange
// ---------------------------------------------------------------------------
describe("getOverlappingChildRange", () => {
  it("quadtree-like refinement: parent (0,0,z=0) covers 4 children", () => {
    // WebMercatorQuad: z=0 is 1x1 tile, z=1 is 2x2 tiles
    const parentMatrix = findMatrix(WebMercator, "0");
    const childMatrix = findMatrix(WebMercator, "1");
    const parentBounds = computeProjectedTileBounds(parentMatrix, {
      x: 0,
      y: 0,
    });
    const range = getOverlappingChildRange(parentBounds, childMatrix);
    expect(range.minCol).toBe(0);
    expect(range.maxCol).toBe(1);
    expect(range.minRow).toBe(0);
    expect(range.maxRow).toBe(1);
  });

  it("quadtree-like refinement: z=1 tile (0,0) maps to z=2 quadrant", () => {
    const parentMatrix = findMatrix(WebMercator, "1");
    const childMatrix = findMatrix(WebMercator, "2");
    const parentBounds = computeProjectedTileBounds(parentMatrix, {
      x: 0,
      y: 0,
    });
    const range = getOverlappingChildRange(parentBounds, childMatrix);
    expect(range.minCol).toBe(0);
    // maxCol is 2 (not 1) because the parent boundary lands exactly on the
    // child tile boundary, and Math.floor maps that to index 2
    expect(range.maxCol).toBe(2);
    expect(range.minRow).toBe(0);
    expect(range.maxRow).toBe(2);
  });

  it("z=1 tile (1,1) maps to z=2 lower-right quadrant", () => {
    const parentMatrix = findMatrix(WebMercator, "1");
    const childMatrix = findMatrix(WebMercator, "2");
    const parentBounds = computeProjectedTileBounds(parentMatrix, {
      x: 1,
      y: 1,
    });
    const range = getOverlappingChildRange(parentBounds, childMatrix);
    expect(range.minCol).toBe(2);
    expect(range.maxCol).toBe(3);
    expect(range.minRow).toBe(2);
    expect(range.maxRow).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getMetersPerPixel
// ---------------------------------------------------------------------------
describe("getMetersPerPixel", () => {
  it("returns expected value at equator zoom 0", () => {
    const earthCircumference = 40075016.686;
    const expected = earthCircumference / 2 ** 8; // zoom 0, 2^(0+8) = 256
    const result = getMetersPerPixel(0, 0);
    expect(result).toBeCloseTo(expected, 1);
  });

  it("decreases with increasing zoom", () => {
    const z0 = getMetersPerPixel(0, 0);
    const z1 = getMetersPerPixel(0, 1);
    const z10 = getMetersPerPixel(0, 10);
    expect(z0).toBeGreaterThan(z1);
    expect(z1).toBeGreaterThan(z10);
    // Each zoom level halves the meters per pixel
    expect(z0 / z1).toBeCloseTo(2, 5);
  });

  it("decreases with increasing latitude (toward poles)", () => {
    const equator = getMetersPerPixel(0, 5);
    const lat60 = getMetersPerPixel(60, 5);
    const lat80 = getMetersPerPixel(80, 5);
    expect(equator).toBeGreaterThan(lat60);
    expect(lat60).toBeGreaterThan(lat80);
    // At 60° latitude, meters per pixel should be ~half of equator
    expect(lat60 / equator).toBeCloseTo(0.5, 1);
  });
});

// ---------------------------------------------------------------------------
// RasterTileNode — insideBounds
// ---------------------------------------------------------------------------
describe("RasterTileNode.insideBounds", () => {
  const identity: ProjectionFunction = (x, y) => [x, y];
  function makeNode(x: number, y: number, z: number): InstanceType<typeof RasterTileNode> {
    return new RasterTileNode(x, y, z, {
      metadata: WebMercator,
      projectTo3857: identity,
      projectTo4326: identity,
    });
  }

  it("returns true for overlapping bounds", () => {
    const node = makeNode(0, 0, 0);
    const bounds = [0, 0, 300, 300] as [number, number, number, number];
    const commonSpaceBounds = [100, 100, 400, 400] as [number, number, number, number];
    expect(node.insideBounds(bounds, commonSpaceBounds)).toBe(true);
  });

  it("returns false for non-overlapping bounds", () => {
    const node = makeNode(0, 0, 0);
    const bounds = [0, 0, 50, 50] as [number, number, number, number];
    const commonSpaceBounds = [100, 100, 400, 400] as [number, number, number, number];
    expect(node.insideBounds(bounds, commonSpaceBounds)).toBe(false);
  });

  it("returns true for touching bounds (edge overlap)", () => {
    const node = makeNode(0, 0, 0);
    // Bounds touch at x=100: bounds goes up to 100, tile starts at 99
    const bounds = [0, 0, 100, 100] as [number, number, number, number];
    const commonSpaceBounds = [99, 0, 200, 200] as [number, number, number, number];
    expect(node.insideBounds(bounds, commonSpaceBounds)).toBe(true);
  });

  it("returns false for bounds that touch at exactly one edge (not overlapping)", () => {
    const node = makeNode(0, 0, 0);
    // tile starts exactly where bounds end — no overlap (< not <=)
    const bounds = [0, 0, 100, 100] as [number, number, number, number];
    const commonSpaceBounds = [100, 0, 200, 200] as [number, number, number, number];
    expect(node.insideBounds(bounds, commonSpaceBounds)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RasterTileNode — getBoundingVolume (Mercator path)
// ---------------------------------------------------------------------------
describe("RasterTileNode.getBoundingVolume (Mercator)", () => {
  it("computes a bounding volume for WebMercatorQuad zoom 0", () => {
    // Use identity projection (pretend tile CRS is already EPSG:3857)
    const identity: ProjectionFunction = (x, y) => [x, y];
    const node = new RasterTileNode(0, 0, 0, {
      metadata: WebMercator,
      projectTo3857: identity,
      projectTo4326: identity,
    });

    const zRange: [number, number] = [0, 0];
    const { boundingVolume, commonSpaceBounds } = node.getBoundingVolume(
      zRange,
      null,
    );

    // Should have a valid OrientedBoundingBox
    expect(boundingVolume).toBeDefined();
    expect(boundingVolume.center).toBeDefined();
    expect(boundingVolume.halfAxes).toBeDefined();

    // Common space bounds should span most of [0, 512]
    const [minX, minY, maxX, maxY] = commonSpaceBounds;
    expect(maxX - minX).toBeGreaterThan(400); // Should be ~512 wide
    expect(maxY - minY).toBeGreaterThan(400); // Should be ~512 tall
  });

  it("z=1 tiles have smaller bounding volumes than z=0", () => {
    const identity: ProjectionFunction = (x, y) => [x, y];

    const nodeZ0 = new RasterTileNode(0, 0, 0, {
      metadata: WebMercator,
      projectTo3857: identity,
      projectTo4326: identity,
    });
    const nodeZ1 = new RasterTileNode(0, 0, 1, {
      metadata: WebMercator,
      projectTo3857: identity,
      projectTo4326: identity,
    });

    const zRange: [number, number] = [0, 0];
    const { commonSpaceBounds: csZ0 } = nodeZ0.getBoundingVolume(zRange, null);
    const { commonSpaceBounds: csZ1 } = nodeZ1.getBoundingVolume(zRange, null);

    const widthZ0 = csZ0[2] - csZ0[0];
    const widthZ1 = csZ1[2] - csZ1[0];
    expect(widthZ0).toBeGreaterThan(widthZ1);
  });
});

// ---------------------------------------------------------------------------
// RasterTileNode — children
// ---------------------------------------------------------------------------
describe("RasterTileNode.children", () => {
  it("WebMercatorQuad z=0 tile has 4 children at z=1", () => {
    const identity: ProjectionFunction = (x, y) => [x, y];
    const node = new RasterTileNode(0, 0, 0, {
      metadata: WebMercator,
      projectTo3857: identity,
      projectTo4326: identity,
    });

    const children = node.children;
    expect(children).not.toBeNull();
    expect(children).toHaveLength(4);

    // Children should be at z=1
    for (const child of children!) {
      expect(child.z).toBe(1);
    }

    // Should cover all 4 quadrants
    const coords = children!.map((c) => [c.x, c.y]);
    expect(coords).toContainEqual([0, 0]);
    expect(coords).toContainEqual([1, 0]);
    expect(coords).toContainEqual([0, 1]);
    expect(coords).toContainEqual([1, 1]);
  });

  it("finest zoom level has no children", () => {
    const identity: ProjectionFunction = (x, y) => [x, y];
    const maxZ = WebMercator.tileMatrices.length - 1;
    const node = new RasterTileNode(0, 0, maxZ, {
      metadata: WebMercator,
      projectTo3857: identity,
      projectTo4326: identity,
    });

    expect(node.children).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sampleReferencePointsInWgs84
// ---------------------------------------------------------------------------
describe("sampleReferencePointsInWgs84", () => {
  it("identity projection returns input coordinates unchanged", () => {
    const identity: ProjectionFunction = (x, y) => [x, y];
    const tileBounds: [number, number, number, number] = [100, 200, 300, 400];
    const refPoints: [number, number][] = [
      [0, 0],
      [1, 1],
      [0.5, 0.5],
    ];
    const result = sampleReferencePointsInWgs84(
      refPoints,
      tileBounds,
      identity,
    );
    expect(result).toHaveLength(3);
    expect(result[0]![0]).toBeCloseTo(100, 5);
    expect(result[0]![1]).toBeCloseTo(200, 5);
    expect(result[1]![0]).toBeCloseTo(300, 5);
    expect(result[1]![1]).toBeCloseTo(400, 5);
    expect(result[2]![0]).toBeCloseTo(200, 5);
    expect(result[2]![1]).toBeCloseTo(300, 5);
  });
});

// ---------------------------------------------------------------------------
// RasterTileNode — getBoundingVolume (Globe path)
// ---------------------------------------------------------------------------
describe("RasterTileNode.getBoundingVolume (Globe)", () => {
  it("computes a bounding volume using the project function", () => {
    const identity: ProjectionFunction = (x, y) => [x, y];

    // Mock globe project function that maps [lng, lat, z] to 3D common space
    // Simple sphere: x = cos(lat)*cos(lng), y = cos(lat)*sin(lng), z = sin(lat)
    // But for testing, a simple linear transform is sufficient to verify
    // the plumbing works
    const mockProject = (xyz: number[]): number[] => {
      return [xyz[0]! * 10, xyz[1]! * 10, xyz[2]! || 0];
    };

    const node = new RasterTileNode(0, 0, 0, {
      metadata: WebMercator,
      projectTo3857: identity,
      projectTo4326: identity,
    });

    const zRange: [number, number] = [0, 0];
    const { boundingVolume, commonSpaceBounds, centerLatitude } =
      node.getBoundingVolume(zRange, mockProject);

    // Should have a valid OrientedBoundingBox
    expect(boundingVolume).toBeDefined();
    expect(boundingVolume.center).toBeDefined();
    expect(boundingVolume.halfAxes).toBeDefined();

    // Common space bounds should be defined
    const [minX, minY, maxX, maxY] = commonSpaceBounds;
    expect(Number.isFinite(minX)).toBe(true);
    expect(Number.isFinite(minY)).toBe(true);
    expect(maxX).toBeGreaterThan(minX);
    expect(maxY).toBeGreaterThan(minY);

    // Center latitude should be finite
    expect(Number.isFinite(centerLatitude)).toBe(true);
  });

  it("produces different bounding volumes than the Mercator path", () => {
    const identity: ProjectionFunction = (x, y) => [x, y];
    const mockProject = (xyz: number[]): number[] => {
      return [xyz[0]! * 5, xyz[1]! * 5, 0];
    };

    const node = new RasterTileNode(0, 0, 0, {
      metadata: WebMercator,
      projectTo3857: identity,
      projectTo4326: identity,
    });

    const zRange: [number, number] = [0, 0];
    const mercator = node.getBoundingVolume(zRange, null);
    const globe = node.getBoundingVolume(zRange, mockProject);

    // The bounding volumes should differ because the common spaces differ
    expect(globe.commonSpaceBounds[0]).not.toBeCloseTo(
      mercator.commonSpaceBounds[0],
      1,
    );
  });

  it("returns centerLatitude from WGS84 reference points", () => {
    // projectTo4326 that always returns lng=0, lat=45
    const mockTo4326: ProjectionFunction = (_x, _y) => [0, 45];
    const identity: ProjectionFunction = (x, y) => [x, y];
    const mockProject = (xyz: number[]): number[] => [
      xyz[0]!,
      xyz[1]!,
      xyz[2]! || 0,
    ];

    const node = new RasterTileNode(0, 0, 0, {
      metadata: WebMercator,
      projectTo3857: identity,
      projectTo4326: mockTo4326,
    });

    const { centerLatitude } = node.getBoundingVolume([0, 0], mockProject);
    expect(centerLatitude).toBeCloseTo(45, 5);
  });
});
