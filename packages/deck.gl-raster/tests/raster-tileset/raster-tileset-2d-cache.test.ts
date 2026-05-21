import {
  _GlobeViewport as GlobeViewport,
  WebMercatorViewport,
} from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { describe, expect, it } from "vitest";
import { RasterTileset2D } from "../../src/raster-tileset/raster-tileset-2d.js";
import type {
  RasterTilesetDescriptor,
  RasterTilesetLevel,
} from "../../src/raster-tileset/tileset-interface.js";
import type { Corners } from "../../src/raster-tileset/types.js";

const identity = (x: number, y: number): [number, number] => [x, y];

function makeLevel(metersPerPixel: number): RasterTilesetLevel {
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

function makeCountingDescriptor(metersPerPixelByLevel: number[]): {
  descriptor: RasterTilesetDescriptor;
  projectCallCount: () => number;
} {
  let count = 0;
  return {
    descriptor: {
      levels: metersPerPixelByLevel.map(makeLevel),
      projectTo3857: (x: number, y: number): [number, number] => {
        count++;
        return [x, y];
      },
      projectTo4326: identity,
      projectFrom3857: identity,
      projectFrom4326: identity,
      projectedBounds: [-1, -1, 1, 1],
    },
    projectCallCount: () => count,
  };
}

function makeViewport(): WebMercatorViewport {
  return new WebMercatorViewport({
    longitude: 0,
    latitude: 0,
    zoom: 18,
    width: 100,
    height: 100,
  });
}

function makeGlobeViewport(): GlobeViewport {
  return new GlobeViewport({
    longitude: 0,
    latitude: 0,
    zoom: 1,
    width: 100,
    height: 100,
    resolution: 10,
  });
}

function tilesetProps(): Tileset2DProps {
  return { getTileData: () => new Promise(() => {}) } as Tileset2DProps;
}

// `getTileIndices` returns RasterTileNode instances, so compare only the
// tile coordinates.
function tileKeys(indices: { x: number; y: number; z: number }[]): string[] {
  return indices.map((i) => `${i.z}/${i.x}/${i.y}`).sort();
}

describe("RasterTileset2D bounding-volume cache", () => {
  it("reuses bounding volumes across getTileIndices calls", () => {
    const { descriptor, projectCallCount } = makeCountingDescriptor([
      1.0, 0.4, 0.1,
    ]);
    const tileset = new RasterTileset2D(tilesetProps(), descriptor);
    const viewport = makeViewport();
    const first = tileset.getTileIndices({ viewport, zRange: null });
    const afterFirst = projectCallCount();
    expect(afterFirst).toBeGreaterThan(0);
    const second = tileset.getTileIndices({ viewport, zRange: null });
    expect(projectCallCount()).toBe(afterFirst); // cache hits only
    expect(tileKeys(second)).toEqual(tileKeys(first));
  });

  it("selects the right tiles with a tiny cache that evicts before every traversal", () => {
    const { descriptor } = makeCountingDescriptor([1.0, 0.4, 0.1]);
    const cached = new RasterTileset2D(tilesetProps(), descriptor, {
      // sweep() runs at the top of each traversal; maxEntries 0 empties it
      maxBoundingVolumeCacheSize: 0,
    });
    const { descriptor: refDescriptor } = makeCountingDescriptor([
      1.0, 0.4, 0.1,
    ]);
    const reference = new RasterTileset2D(tilesetProps(), refDescriptor);
    const viewport = makeViewport();
    const expected = tileKeys(
      reference.getTileIndices({ viewport, zRange: null }),
    );
    expect(tileKeys(cached.getTileIndices({ viewport, zRange: null }))).toEqual(
      expected,
    );
    expect(tileKeys(cached.getTileIndices({ viewport, zRange: null }))).toEqual(
      expected,
    );
    expect(tileKeys(cached.getTileIndices({ viewport, zRange: null }))).toEqual(
      expected,
    );
  });

  it("clears the cache when the viewport projection mode switches", () => {
    const { descriptor, projectCallCount } = makeCountingDescriptor([
      1.0, 0.4, 0.1,
    ]);
    const tileset = new RasterTileset2D(tilesetProps(), descriptor);
    const mercator = makeViewport();
    const globe = makeGlobeViewport();

    tileset.getTileIndices({ viewport: mercator, zRange: null });
    const afterFirst = projectCallCount();
    expect(afterFirst).toBeGreaterThan(0);

    // Second mercator call hits the cache — no new projectTo3857 calls.
    tileset.getTileIndices({ viewport: mercator, zRange: null });
    expect(projectCallCount()).toBe(afterFirst);

    // Switching to a globe viewport clears the cache. The globe path projects
    // to WGS84 (projectTo4326, uncounted), so the counter is unchanged here…
    tileset.getTileIndices({ viewport: globe, zRange: null });
    expect(projectCallCount()).toBe(afterFirst);

    // …but the next mercator call must recompute from scratch (cache empty),
    // doubling the projectTo3857 count.
    tileset.getTileIndices({ viewport: mercator, zRange: null });
    expect(projectCallCount()).toBe(afterFirst * 2);
  });
});
