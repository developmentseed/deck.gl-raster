import { WebMercatorViewport } from "@deck.gl/core";
import { describe, expect, it } from "vitest";
import { BoundingVolumeCache } from "../../src/raster-tileset/bounding-volume-cache.js";
import { getTileIndices } from "../../src/raster-tileset/raster-tile-traversal.js";
import type {
  RasterTilesetDescriptor,
  RasterTilesetLevel,
} from "../../src/raster-tileset/tileset-interface.js";
import type { Bounds, Corners } from "../../src/raster-tileset/types.js";

const identity = (x: number, y: number): [number, number] => [x, y];

/** Single-tile level covering [-1, -1, 1, 1] with the given metersPerPixel. */
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

/**
 * A descriptor whose `projectTo3857` counts its invocations, so a test can
 * assert that a second traversal does not recompute bounding volumes.
 */
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

function indicesOpts(viewport: WebMercatorViewport) {
  return {
    viewport,
    maxZ: 2,
    zRange: null,
    wgs84Bounds: [-1, -1, 1, 1] as Bounds,
    pixelRatio: 1,
  };
}

// `getTileIndices` returns RasterTileNode instances (which carry the
// descriptor, child caches, etc.), so compare only the tile coordinates.
function tileKeys(indices: { x: number; y: number; z: number }[]): string[] {
  return indices.map((i) => `${i.z}/${i.x}/${i.y}`).sort();
}

describe("getTileIndices: bounding-volume cache", () => {
  it("recomputes bounding volumes on every call without a cache", () => {
    const { descriptor, projectCallCount } = makeCountingDescriptor([
      1.0, 0.4, 0.1,
    ]);
    const viewport = makeViewport();
    getTileIndices(descriptor, indicesOpts(viewport));
    const afterFirst = projectCallCount();
    expect(afterFirst).toBeGreaterThan(0);
    getTileIndices(descriptor, indicesOpts(viewport));
    expect(projectCallCount()).toBe(afterFirst * 2);
  });

  it("does not recompute bounding volumes on a second call when a cache is reused", () => {
    const { descriptor, projectCallCount } = makeCountingDescriptor([
      1.0, 0.4, 0.1,
    ]);
    const cache = new BoundingVolumeCache();
    const viewport = makeViewport();
    const first = getTileIndices(descriptor, {
      ...indicesOpts(viewport),
      boundingVolumeCache: cache,
    });
    const afterFirst = projectCallCount();
    expect(afterFirst).toBeGreaterThan(0);
    const second = getTileIndices(descriptor, {
      ...indicesOpts(viewport),
      boundingVolumeCache: cache,
    });
    expect(projectCallCount()).toBe(afterFirst); // cache hits only
    expect(tileKeys(second)).toEqual(tileKeys(first)); // identical selection
  });

  it("selects the same tiles whether or not a cache is used", () => {
    const a = makeCountingDescriptor([1.0, 0.4, 0.1]);
    const b = makeCountingDescriptor([1.0, 0.4, 0.1]);
    const viewport = makeViewport();
    const withoutCache = getTileIndices(a.descriptor, indicesOpts(viewport));
    const withCache = getTileIndices(b.descriptor, {
      ...indicesOpts(viewport),
      boundingVolumeCache: new BoundingVolumeCache(),
    });
    expect(tileKeys(withCache)).toEqual(tileKeys(withoutCache));
  });
});
