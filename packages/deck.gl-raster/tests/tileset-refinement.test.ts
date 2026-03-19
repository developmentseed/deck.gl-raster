/**
 * Tests for TileMatrixSetTileset refinement strategy.
 *
 * Verifies that when zooming in, parent tiles already in cache remain visible
 * while child tiles are still loading (best-available / no-flash behavior).
 */

import type { Viewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import { describe, expect, it } from "vitest";
import { TileMatrixSetTileset } from "../src/raster-tileset/raster-tileset-2d.js";
import type { TileIndex } from "../src/raster-tileset/types.js";

// ---------------------------------------------------------------------------
// Minimal TileMatrixSet fixture (2 zoom levels, EPSG:4326 image space)
// ---------------------------------------------------------------------------
//
//  z=0: 1×1 tile covering the whole image
//  z=1: 2×2 tiles each covering a quadrant
//
// cellSize ratio is 2 (standard power-of-2 pyramid).

const MOCK_TMS: TileMatrixSet = {
  id: "test",
  crs: { uri: "http://www.opengis.net/def/crs/EPSG/0/4326" },
  boundingBox: {
    lowerLeft: [0, 0],
    upperRight: [1, 1],
  },
  tileMatrices: [
    {
      id: "0",
      scaleDenominator: 1000,
      cellSize: 0.02,
      cornerOfOrigin: "topLeft" as const,
      pointOfOrigin: [0, 1],
      tileWidth: 64,
      tileHeight: 64,
      matrixWidth: 1,
      matrixHeight: 1,
    },
    {
      id: "1",
      scaleDenominator: 500,
      cellSize: 0.01,
      cornerOfOrigin: "topLeft" as const,
      pointOfOrigin: [0, 1],
      tileWidth: 64,
      tileHeight: 64,
      matrixWidth: 2,
      matrixHeight: 2,
    },
  ],
};

// Identity projection (image CRS == WGS84 for this fixture)
const identity = (x: number, y: number): [number, number] => [x, y];

// ---------------------------------------------------------------------------
// Test-friendly subclass: override getTileIndices to control which tiles are
// "visible" at each simulated zoom level without needing a real Viewport.
// ---------------------------------------------------------------------------

class ControlledTileset extends TileMatrixSetTileset {
  private _forcedIndices: TileIndex[] = [];

  setForcedIndices(indices: TileIndex[]) {
    this._forcedIndices = indices;
  }

  override getTileIndices(
    _opts: Parameters<TileMatrixSetTileset["getTileIndices"]>[0],
  ): TileIndex[] {
    return this._forcedIndices;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal mock viewport whose `equals()` always returns false so that
 * `Tileset2D.update()` always re-evaluates the tile selection.
 */
function makeViewport(): Viewport {
  return {
    equals: () => false,
    resolution: undefined,
  } as unknown as Viewport;
}

/**
 * Build a ControlledTileset with a never-resolving getTileData so that
 * tiles stay in the "loading" state for the duration of the test.
 */
function makeTileset(opts?: Partial<Tileset2DProps>): ControlledTileset {
  return new ControlledTileset(
    {
      getTileData: () => new Promise(() => {}), // never resolves
      ...opts,
    },
    MOCK_TMS,
    { projectTo4326: identity, projectTo3857: identity },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TileMatrixSetTileset – best-available refinement", () => {
  it("marks the z=0 parent visible while z=1 children are loading", async () => {
    const tileset = makeTileset();

    // --- Step 1: simulate viewport at z=0 (one tile covers the whole image)
    tileset.setForcedIndices([{ x: 0, y: 0, z: 0 }]);
    tileset.update(makeViewport(), { zRange: null, modelMatrix: null });

    // The z=0 tile is now selected and loading.
    const parentTile = tileset.tiles.find(
      (t) => t.index.x === 0 && t.index.y === 0 && t.index.z === 0,
    );

    if (!parentTile) {
      expect.fail("parent tile should be in cache");
    }

    // Simulate the tile loading successfully by injecting content.
    parentTile.content = { width: 64, height: 64 };
    // @ts-expect-error _isLoaded is private
    parentTile._isLoaded = true;

    // Run another update so the tileset sees the loaded state.
    tileset.setForcedIndices([{ x: 0, y: 0, z: 0 }]);
    tileset.update(makeViewport(), { zRange: null, modelMatrix: null });

    expect(parentTile!.isLoaded).toBe(true);
    expect(parentTile!.isVisible).toBe(true);

    // --- Step 2: zoom in — z=1 tiles are now selected, still loading
    tileset.setForcedIndices([
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
    ]);
    tileset.update(makeViewport(), { zRange: null, modelMatrix: null });

    // All four z=1 tiles should be in cache and loading (never-resolve getData)
    const childTiles = tileset.tiles.filter((t) => t.index.z === 1);
    expect(childTiles).toHaveLength(4);
    for (const child of childTiles) {
      expect(child.isLoaded, `child ${child.id} should still be loading`).toBe(
        false,
      );
    }

    // The z=0 parent should still be visible as a placeholder.
    expect(
      parentTile!.isVisible,
      "parent tile should remain visible while children are loading",
    ).toBe(true);

    // The loading child tiles should NOT be visible (no content yet).
    for (const child of childTiles) {
      expect(
        child.isVisible,
        `loading child ${child.id} should not be visible`,
      ).toBe(false);
    }
  });

  it("hides the parent once all children have loaded", async () => {
    const tileset = makeTileset();

    // Load z=0 parent
    tileset.setForcedIndices([{ x: 0, y: 0, z: 0 }]);
    tileset.update(makeViewport(), { zRange: null, modelMatrix: null });

    const parentTile = tileset.tiles.find((t) => t.index.z === 0)!;
    parentTile.content = { width: 64, height: 64 };
    // @ts-expect-error _isLoaded is private
    parentTile._isLoaded = true;

    // Zoom in
    tileset.setForcedIndices([
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
    ]);
    tileset.update(makeViewport(), { zRange: null, modelMatrix: null });

    // Load all children
    const childTiles = tileset.tiles.filter((t) => t.index.z === 1);
    for (const child of childTiles) {
      child.content = { width: 64, height: 64 };
      // @ts-expect-error _isLoaded is private
      child._isLoaded = true;
    }

    tileset.update(makeViewport(), { zRange: null, modelMatrix: null });

    // Now children are loaded and selected, so the parent should not be visible.
    expect(
      parentTile.isVisible,
      "parent should not be visible once children are loaded",
    ).toBe(false);

    for (const child of childTiles) {
      expect(
        child.isVisible,
        `loaded child ${child.id} should be visible`,
      ).toBe(true);
    }
  });

  it("getParentIndex correctly maps z=1 children to z=0 parent (2:1 ratio)", () => {
    const tileset = makeTileset();

    // MOCK_TMS: z=0 cellSize=0.02 tileWidth=64, z=1 cellSize=0.01 tileWidth=64
    // Footprint ratio = (0.02*64) / (0.01*64) = 2 → each parent covers 2×2 children.
    const parent00 = tileset.getParentIndex({ x: 0, y: 0, z: 1 });
    const parent10 = tileset.getParentIndex({ x: 1, y: 0, z: 1 });
    const parent01 = tileset.getParentIndex({ x: 0, y: 1, z: 1 });
    const parent11 = tileset.getParentIndex({ x: 1, y: 1, z: 1 });

    expect(parent00).toEqual({ x: 0, y: 0, z: 0 });
    expect(parent10).toEqual({ x: 0, y: 0, z: 0 });
    expect(parent01).toEqual({ x: 0, y: 0, z: 0 });
    expect(parent11).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("getParentIndex correctly handles 1:1 spatial mapping when tileWidth doubles", () => {
    // Sentinel-2-like TMS: last overview doubles tileWidth while halving cellSize,
    // so parent and child tiles cover the exact same spatial footprint.
    // decimation should be 1 (each child maps to the parent at the same x,y).
    const sentinel2TMS: TileMatrixSet = {
      id: "s2",
      crs: { uri: "http://www.opengis.net/def/crs/EPSG/0/32618" },
      boundingBox: {
        lowerLeft: [499980, 4490220],
        upperRight: [609780, 4600020],
      },
      tileMatrices: [
        // z=3: cellSize=20, tileWidth=512 → footprint = 10240m
        {
          id: "3",
          scaleDenominator: 71428.57,
          cellSize: 20,
          cornerOfOrigin: "topLeft" as const,
          pointOfOrigin: [499980, 4600020],
          tileWidth: 512,
          tileHeight: 512,
          matrixWidth: 11,
          matrixHeight: 11,
        },
        // z=4: cellSize=10, tileWidth=1024 → footprint = 10240m  (same as z=3!)
        {
          id: "4",
          scaleDenominator: 35714.29,
          cellSize: 10,
          cornerOfOrigin: "topLeft" as const,
          pointOfOrigin: [499980, 4600020],
          tileWidth: 1024,
          tileHeight: 1024,
          matrixWidth: 11,
          matrixHeight: 11,
        },
      ],
    };

    const tileset = new ControlledTileset(
      { getTileData: () => new Promise(() => {}) },
      sentinel2TMS as any,
      { projectTo4326: identity, projectTo3857: identity },
    );

    // Every z=4 tile should map 1:1 to the z=3 tile at the same x,y.
    expect(tileset.getParentIndex({ x: 0, y: 0, z: 1 })).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
    expect(tileset.getParentIndex({ x: 5, y: 5, z: 1 })).toEqual({
      x: 5,
      y: 5,
      z: 0,
    });
    expect(tileset.getParentIndex({ x: 10, y: 10, z: 1 })).toEqual({
      x: 10,
      y: 10,
      z: 0,
    });
  });

  it("getTileMetadata includes a bbox in GeoBoundingBox format", () => {
    const tileset = makeTileset();

    const meta = tileset.getTileMetadata({ x: 0, y: 0, z: 0 });

    expect(meta.bbox).toBeDefined();
    const { bbox } = meta;
    expect(typeof bbox.west).toBe("number");
    expect(typeof bbox.south).toBe("number");
    expect(typeof bbox.east).toBe("number");
    expect(typeof bbox.north).toBe("number");
    expect(bbox.west).toBeLessThan(bbox.east);
    expect(bbox.south).toBeLessThan(bbox.north);
  });
});
