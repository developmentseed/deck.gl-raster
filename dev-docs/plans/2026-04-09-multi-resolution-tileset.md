# Multi-Resolution Tileset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable rendering multiple satellite bands at different spatial resolutions (10m, 20m, 60m) in a single shader pass, with GPU-side resampling via UV transforms.

**Architecture:** A `MultiTilesetDescriptor` in `deck.gl-raster` describes the relationship between tile grids at different resolutions. A `MultiCOGLayer` in `deck.gl-geotiff` orchestrates fetching tiles from multiple COGs, stitching across tile boundaries, computing UV transforms, and passing named textures to the shader. The primary (highest-resolution) tileset drives tile traversal; secondary tilesets are consulted at fetch time.

**Tech Stack:** TypeScript, deck.gl (CompositeLayer, TileLayer, Tileset2D), luma.gl (Texture, ShaderModule), geotiff.js, vitest, Biome

**Spec:** `dev-docs/specs/2026-04-09-multi-resolution-tileset-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `packages/deck.gl-raster/src/raster-tileset/multi-tileset-descriptor.ts` | `MultiTilesetDescriptor` type + `createMultiTilesetDescriptor()` factory + `selectSecondaryLevel()` + `tilesetLevelsEqual()` |
| `packages/deck.gl-raster/src/raster-tileset/secondary-tile-resolver.ts` | `resolveSecondaryTiles()` — computes covering tile ranges and UV transforms for a primary tile against a secondary tileset |
| `packages/deck.gl-raster/src/gpu-modules/composite-bands.ts` | `CompositeBands` GPU module — samples named band textures with UV transforms, outputs `vec4` |
| `packages/deck.gl-geotiff/src/multi-cog-layer.ts` | `MultiCOGLayer` — orchestrates multi-source COG loading, tile fetching, stitching, rendering |
| `packages/deck.gl-raster/tests/multi-tileset-descriptor.test.ts` | Tests for `MultiTilesetDescriptor` creation and validation |
| `packages/deck.gl-raster/tests/secondary-tile-resolver.test.ts` | Tests for secondary tile resolution and UV transform computation |
| `packages/deck.gl-raster/tests/composite-bands.test.ts` | Tests for `CompositeBands` module structure |

### Modified files

| File | Change |
|------|--------|
| `packages/deck.gl-raster/src/raster-tileset/index.ts` | Export new types and functions |
| `packages/deck.gl-raster/src/gpu-modules/index.ts` | Export `CompositeBands` |
| `packages/deck.gl-raster/src/index.ts` | Export new public types |
| `packages/deck.gl-geotiff/src/index.ts` | Export `MultiCOGLayer` |

---

## Task 1: MultiTilesetDescriptor Type and Factory

**Files:**
- Create: `packages/deck.gl-raster/src/raster-tileset/multi-tileset-descriptor.ts`
- Test: `packages/deck.gl-raster/tests/multi-tileset-descriptor.test.ts`
- Modify: `packages/deck.gl-raster/src/raster-tileset/index.ts`

- [ ] **Step 1: Write tests for MultiTilesetDescriptor**

Create test file with mock tilesets representing 10m and 20m grids:

```ts
// packages/deck.gl-raster/tests/multi-tileset-descriptor.test.ts
import { describe, expect, it } from "vitest";
import {
  createMultiTilesetDescriptor,
  selectSecondaryLevel,
  tilesetLevelsEqual,
} from "../src/raster-tileset/multi-tileset-descriptor.js";
import type {
  TilesetDescriptor,
  TilesetLevel,
} from "../src/raster-tileset/tileset-interface.js";
import type { Corners, Point } from "../src/raster-tileset/types.js";

/** Helper: create a mock TilesetLevel */
function mockLevel(opts: {
  matrixWidth: number;
  matrixHeight: number;
  tileWidth: number;
  tileHeight: number;
  metersPerPixel: number;
}): TilesetLevel {
  return {
    ...opts,
    projectedTileCorners: (_col: number, _row: number): Corners => ({
      topLeft: [0, 1] as Point,
      topRight: [1, 1] as Point,
      bottomLeft: [0, 0] as Point,
      bottomRight: [1, 0] as Point,
    }),
    crsBoundsToTileRange: () => ({
      minCol: 0,
      maxCol: 0,
      minRow: 0,
      maxRow: 0,
    }),
  };
}

/** Helper: create a mock TilesetDescriptor */
function mockDescriptor(levels: TilesetLevel[]): TilesetDescriptor {
  const identity = (x: number, y: number): [number, number] => [x, y];
  return {
    levels,
    projectTo3857: identity,
    projectTo4326: identity,
    projectedBounds: [600000, 7890000, 710000, 8000000],
  };
}

describe("tilesetLevelsEqual", () => {
  it("returns true for levels with same grid parameters", () => {
    const a = mockLevel({
      matrixWidth: 43,
      matrixHeight: 43,
      tileWidth: 256,
      tileHeight: 256,
      metersPerPixel: 10,
    });
    const b = mockLevel({
      matrixWidth: 43,
      matrixHeight: 43,
      tileWidth: 256,
      tileHeight: 256,
      metersPerPixel: 10,
    });
    expect(tilesetLevelsEqual(a, b)).toBe(true);
  });

  it("returns false for levels with different grid parameters", () => {
    const a = mockLevel({
      matrixWidth: 43,
      matrixHeight: 43,
      tileWidth: 256,
      tileHeight: 256,
      metersPerPixel: 10,
    });
    const b = mockLevel({
      matrixWidth: 22,
      matrixHeight: 22,
      tileWidth: 256,
      tileHeight: 256,
      metersPerPixel: 20,
    });
    expect(tilesetLevelsEqual(a, b)).toBe(false);
  });
});

describe("createMultiTilesetDescriptor", () => {
  it("selects the finest-resolution tileset as primary", () => {
    const fine = mockDescriptor([
      mockLevel({
        matrixWidth: 1,
        matrixHeight: 1,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 100,
      }),
      mockLevel({
        matrixWidth: 43,
        matrixHeight: 43,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 10,
      }),
    ]);
    const coarse = mockDescriptor([
      mockLevel({
        matrixWidth: 1,
        matrixHeight: 1,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 200,
      }),
      mockLevel({
        matrixWidth: 22,
        matrixHeight: 22,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 20,
      }),
    ]);

    const multi = createMultiTilesetDescriptor(
      new Map([
        ["red", fine],
        ["swir", coarse],
      ]),
    );

    // Primary should be the 10m tileset (finest metersPerPixel at last level)
    expect(multi.primary).toBe(fine);
    expect(multi.secondaries.size).toBe(1);
    expect(multi.secondaries.get("swir")).toBe(coarse);
  });

  it("does not include the primary key in secondaries", () => {
    const fine = mockDescriptor([
      mockLevel({
        matrixWidth: 43,
        matrixHeight: 43,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 10,
      }),
    ]);
    const coarse = mockDescriptor([
      mockLevel({
        matrixWidth: 22,
        matrixHeight: 22,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 20,
      }),
    ]);

    const multi = createMultiTilesetDescriptor(
      new Map([
        ["red", fine],
        ["swir", coarse],
      ]),
    );

    expect(multi.secondaries.has("red")).toBe(false);
  });
});

describe("selectSecondaryLevel", () => {
  it("picks the finest level that is >= primary metersPerPixel", () => {
    const levels = [
      mockLevel({
        matrixWidth: 1,
        matrixHeight: 1,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 200,
      }),
      mockLevel({
        matrixWidth: 5,
        matrixHeight: 5,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 60,
      }),
      mockLevel({
        matrixWidth: 22,
        matrixHeight: 22,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 20,
      }),
    ];

    // Primary at 10m — secondary's finest is 20m, which is the best available
    const selected = selectSecondaryLevel(levels, 10);
    expect(selected).toBe(levels[2]);
  });

  it("returns the finest level when all are coarser than primary", () => {
    const levels = [
      mockLevel({
        matrixWidth: 1,
        matrixHeight: 1,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 200,
      }),
      mockLevel({
        matrixWidth: 3,
        matrixHeight: 3,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 60,
      }),
    ];

    // Primary at 10m — finest secondary is 60m, still the best we have
    const selected = selectSecondaryLevel(levels, 10);
    expect(selected).toBe(levels[1]);
  });

  it("selects a coarser level when primary is zoomed out", () => {
    const levels = [
      mockLevel({
        matrixWidth: 1,
        matrixHeight: 1,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 200,
      }),
      mockLevel({
        matrixWidth: 5,
        matrixHeight: 5,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 60,
      }),
      mockLevel({
        matrixWidth: 22,
        matrixHeight: 22,
        tileWidth: 256,
        tileHeight: 256,
        metersPerPixel: 20,
      }),
    ];

    // Primary at 100m (zoomed out) — 60m level is closest finer-or-equal
    const selected = selectSecondaryLevel(levels, 100);
    expect(selected).toBe(levels[1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/deck.gl-raster/tests/multi-tileset-descriptor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MultiTilesetDescriptor**

```ts
// packages/deck.gl-raster/src/raster-tileset/multi-tileset-descriptor.ts
import type { TilesetDescriptor, TilesetLevel } from "./tileset-interface.js";
import type { Bounds, ProjectionFunction } from "./types.js";

/**
 * Groups N tilesets representing the same geographic extent at different
 * native resolutions. The primary tileset (finest resolution) drives tile
 * traversal; secondaries are consulted at fetch time.
 */
export interface MultiTilesetDescriptor {
  /** Highest-resolution tileset — drives tile traversal. */
  primary: TilesetDescriptor;

  /** The key under which the primary was provided. */
  primaryKey: string;

  /** Lower-resolution tilesets, keyed by user-defined name. */
  secondaries: Map<string, TilesetDescriptor>;

  /** Shared CRS bounds (from primary). */
  bounds: Bounds;

  /** Shared projection: source CRS -> EPSG:3857. */
  projectTo3857: ProjectionFunction;

  /** Shared projection: source CRS -> EPSG:4326. */
  projectTo4326: ProjectionFunction;
}

/**
 * Create a MultiTilesetDescriptor from a map of named tilesets.
 *
 * Automatically selects the tileset with the finest `metersPerPixel` at its
 * highest-resolution level as the primary. All others become secondaries.
 */
export function createMultiTilesetDescriptor(
  tilesets: Map<string, TilesetDescriptor>,
): MultiTilesetDescriptor {
  if (tilesets.size === 0) {
    throw new Error("At least one tileset is required");
  }

  // Find the tileset with the finest metersPerPixel at its last (finest) level
  let primaryKey: string | null = null;
  let finestMpp = Number.POSITIVE_INFINITY;

  for (const [key, descriptor] of tilesets) {
    const finestLevel = descriptor.levels[descriptor.levels.length - 1];
    if (finestLevel && finestLevel.metersPerPixel < finestMpp) {
      finestMpp = finestLevel.metersPerPixel;
      primaryKey = key;
    }
  }

  const primary = tilesets.get(primaryKey!)!;

  const secondaries = new Map<string, TilesetDescriptor>();
  for (const [key, descriptor] of tilesets) {
    if (key !== primaryKey) {
      secondaries.set(key, descriptor);
    }
  }

  return {
    primary,
    primaryKey: primaryKey!,
    secondaries,
    bounds: primary.projectedBounds,
    projectTo3857: primary.projectTo3857,
    projectTo4326: primary.projectTo4326,
  };
}

/**
 * Select the best level from a secondary tileset for a given primary
 * metersPerPixel.
 *
 * Picks the finest level whose `metersPerPixel` is <= the primary's. If all
 * secondary levels are coarser, returns the finest available (last level).
 *
 * Levels are ordered coarsest-first (index 0 = coarsest).
 */
export function selectSecondaryLevel(
  levels: TilesetLevel[],
  primaryMetersPerPixel: number,
): TilesetLevel {
  // Walk from finest to coarsest, find the first level that is finer-or-equal
  // to the primary's resolution
  for (let i = levels.length - 1; i >= 0; i--) {
    if (levels[i]!.metersPerPixel <= primaryMetersPerPixel) {
      return levels[i]!;
    }
  }

  // All levels are coarser — return the finest available
  return levels[levels.length - 1]!;
}

/**
 * Check if two tileset levels have the same grid parameters (same tile grid).
 * Used to detect when sources share a tile grid and can skip UV transform
 * computation.
 */
export function tilesetLevelsEqual(
  a: TilesetLevel,
  b: TilesetLevel,
): boolean {
  return (
    a.matrixWidth === b.matrixWidth &&
    a.matrixHeight === b.matrixHeight &&
    a.tileWidth === b.tileWidth &&
    a.tileHeight === b.tileHeight &&
    a.metersPerPixel === b.metersPerPixel
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/deck.gl-raster/tests/multi-tileset-descriptor.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Add exports**

In `packages/deck.gl-raster/src/raster-tileset/index.ts`, add:

```ts
export type { MultiTilesetDescriptor } from "./multi-tileset-descriptor.js";
export {
  createMultiTilesetDescriptor,
  selectSecondaryLevel,
  tilesetLevelsEqual,
} from "./multi-tileset-descriptor.js";
```

In `packages/deck.gl-raster/src/index.ts`, add to the raster-tileset re-exports:

```ts
export type { MultiTilesetDescriptor } from "./raster-tileset/index.js";
export {
  createMultiTilesetDescriptor,
  selectSecondaryLevel,
  tilesetLevelsEqual,
} from "./raster-tileset/index.js";
```

- [ ] **Step 6: Run full test suite and lint**

Run: `npx vitest run packages/deck.gl-raster/`
Run: `npx biome check packages/deck.gl-raster/src/raster-tileset/multi-tileset-descriptor.ts`

- [ ] **Step 7: Commit**

```bash
git add packages/deck.gl-raster/src/raster-tileset/multi-tileset-descriptor.ts \
       packages/deck.gl-raster/tests/multi-tileset-descriptor.test.ts \
       packages/deck.gl-raster/src/raster-tileset/index.ts \
       packages/deck.gl-raster/src/index.ts
git commit -m "feat: add MultiTilesetDescriptor type and factory"
```

---

## Task 2: Secondary Tile Resolver

Computes which secondary tiles cover a primary tile's extent, and the UV transform to map between them.

**Files:**
- Create: `packages/deck.gl-raster/src/raster-tileset/secondary-tile-resolver.ts`
- Test: `packages/deck.gl-raster/tests/secondary-tile-resolver.test.ts`
- Modify: `packages/deck.gl-raster/src/raster-tileset/index.ts`

- [ ] **Step 1: Write tests for secondary tile resolution**

```ts
// packages/deck.gl-raster/tests/secondary-tile-resolver.test.ts
import { describe, expect, it } from "vitest";
import { resolveSecondaryTiles } from "../src/raster-tileset/secondary-tile-resolver.js";
import type { TilesetLevel } from "../src/raster-tileset/tileset-interface.js";
import type { Bounds, Corners, Point } from "../src/raster-tileset/types.js";

/**
 * Create a mock TilesetLevel backed by a regular grid.
 *
 * originX/originY is the top-left corner of the grid in CRS coordinates.
 * cellSize is CRS units per pixel.
 */
function gridLevel(opts: {
  originX: number;
  originY: number;
  cellSize: number;
  tileWidth: number;
  tileHeight: number;
  matrixWidth: number;
  matrixHeight: number;
}): TilesetLevel {
  const {
    originX,
    originY,
    cellSize,
    tileWidth,
    tileHeight,
    matrixWidth,
    matrixHeight,
  } = opts;
  const tileCrsWidth = tileWidth * cellSize;
  const tileCrsHeight = tileHeight * cellSize;

  return {
    matrixWidth,
    matrixHeight,
    tileWidth,
    tileHeight,
    metersPerPixel: cellSize,
    projectedTileCorners: (col: number, row: number): Corners => {
      const minX = originX + col * tileCrsWidth;
      const maxX = minX + tileCrsWidth;
      const maxY = originY - row * tileCrsHeight;
      const minY = maxY - tileCrsHeight;
      return {
        topLeft: [minX, maxY] as Point,
        topRight: [maxX, maxY] as Point,
        bottomLeft: [minX, minY] as Point,
        bottomRight: [maxX, minY] as Point,
      };
    },
    crsBoundsToTileRange: (
      projectedMinX: number,
      projectedMinY: number,
      projectedMaxX: number,
      projectedMaxY: number,
    ) => {
      let minCol = Math.floor((projectedMinX - originX) / tileCrsWidth);
      let maxCol = Math.floor((projectedMaxX - originX) / tileCrsWidth);
      let minRow = Math.floor((originY - projectedMaxY) / tileCrsHeight);
      let maxRow = Math.floor((originY - projectedMinY) / tileCrsHeight);

      minCol = Math.max(0, Math.min(matrixWidth - 1, minCol));
      maxCol = Math.max(0, Math.min(matrixWidth - 1, maxCol));
      minRow = Math.max(0, Math.min(matrixHeight - 1, minRow));
      maxRow = Math.max(0, Math.min(matrixHeight - 1, maxRow));

      return { minCol, maxCol, minRow, maxRow };
    },
  };
}

describe("resolveSecondaryTiles", () => {
  // Both grids share origin (600000, 8000000), top-left convention.
  // Primary: 10m, 256px tiles → each tile covers 2560m
  // Secondary: 20m, 256px tiles → each tile covers 5120m

  const origin = { x: 600000, y: 8000000 };

  const primaryLevel = gridLevel({
    originX: origin.x,
    originY: origin.y,
    cellSize: 10,
    tileWidth: 256,
    tileHeight: 256,
    matrixWidth: 43,
    matrixHeight: 43,
  });

  const secondaryLevel = gridLevel({
    originX: origin.x,
    originY: origin.y,
    cellSize: 20,
    tileWidth: 256,
    tileHeight: 256,
    matrixWidth: 22,
    matrixHeight: 22,
  });

  it("returns identity UV transform when primary tile is fully inside one secondary tile", () => {
    // Primary tile (0,0) covers [600000, 7997440] to [602560, 8000000]
    // Secondary tile (0,0) covers [600000, 7994880] to [605120, 8000000]
    // Primary is fully inside secondary.
    const result = resolveSecondaryTiles(primaryLevel, 0, 0, secondaryLevel);

    expect(result.tileIndices).toEqual([{ col: 0, row: 0 }]);

    // UV transform: primary extent maps to the top-left quarter of secondary
    // offsetX = (600000 - 600000) / 5120 = 0
    // offsetY = (8000000 - 8000000) / 5120 = 0
    // scaleX = 2560 / 5120 = 0.5
    // scaleY = 2560 / 5120 = 0.5
    expect(result.uvTransform[0]).toBeCloseTo(0); // offsetX
    expect(result.uvTransform[1]).toBeCloseTo(0); // offsetY
    expect(result.uvTransform[2]).toBeCloseTo(0.5); // scaleX
    expect(result.uvTransform[3]).toBeCloseTo(0.5); // scaleY
  });

  it("computes correct UV offset for non-origin primary tile", () => {
    // Primary tile (1,0): covers [602560, 7997440] to [605120, 8000000]
    // Secondary tile (0,0): covers [600000, 7994880] to [605120, 8000000]
    // Primary is in the right half of secondary.
    const result = resolveSecondaryTiles(primaryLevel, 1, 0, secondaryLevel);

    expect(result.tileIndices).toEqual([{ col: 0, row: 0 }]);

    // offsetX = (602560 - 600000) / 5120 = 0.5
    // offsetY = (8000000 - 8000000) / 5120 = 0
    // scaleX = 2560 / 5120 = 0.5
    // scaleY = 2560 / 5120 = 0.5
    expect(result.uvTransform[0]).toBeCloseTo(0.5);
    expect(result.uvTransform[1]).toBeCloseTo(0);
    expect(result.uvTransform[2]).toBeCloseTo(0.5);
    expect(result.uvTransform[3]).toBeCloseTo(0.5);
  });

  it("handles primary tile spanning two secondary tiles", () => {
    // Primary tile (2,0): covers [605120, 7997440] to [607680, 8000000]
    // This crosses the boundary between secondary tiles (0,0) and (1,0)
    // Secondary tile (0,0): [600000, 7994880] to [605120, 8000000]
    // Secondary tile (1,0): [605120, 7994880] to [610240, 8000000]
    const result = resolveSecondaryTiles(primaryLevel, 2, 0, secondaryLevel);

    expect(result.tileIndices.length).toBe(2);

    // Stitched extent covers both secondary tiles: [600000..610240] x [7994880..8000000]
    // But we only need the secondary tiles that overlap.
    // The UV transform maps primary into the stitched region.
    // stitchedWidth = 10240, stitchedHeight = 5120
    // scaleX = 2560 / 10240 = 0.25
    // offsetX = (605120 - 600000) / 10240 = 0.5
    expect(result.uvTransform[2]).toBeCloseTo(0.25); // scaleX
    expect(result.uvTransform[0]).toBeCloseTo(0.5); // offsetX
  });

  it("returns identity-like transform when grids align exactly", () => {
    // When primary and secondary have the same grid, tile (0,0) maps 1:1
    const result = resolveSecondaryTiles(
      primaryLevel,
      0,
      0,
      primaryLevel,
    );

    expect(result.tileIndices).toEqual([{ col: 0, row: 0 }]);
    expect(result.uvTransform[0]).toBeCloseTo(0); // offsetX
    expect(result.uvTransform[1]).toBeCloseTo(0); // offsetY
    expect(result.uvTransform[2]).toBeCloseTo(1); // scaleX
    expect(result.uvTransform[3]).toBeCloseTo(1); // scaleY
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/deck.gl-raster/tests/secondary-tile-resolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement resolveSecondaryTiles**

```ts
// packages/deck.gl-raster/src/raster-tileset/secondary-tile-resolver.ts
import type { TilesetLevel } from "./tileset-interface.js";

/** A tile index in a secondary tileset */
export interface SecondaryTileIndex {
  col: number;
  row: number;
}

/**
 * Result of resolving secondary tiles for a primary tile.
 */
export interface SecondaryTileResolution {
  /** The secondary tile indices that cover the primary tile's extent. */
  tileIndices: SecondaryTileIndex[];

  /**
   * UV transform: [offsetX, offsetY, scaleX, scaleY].
   *
   * Maps from the primary tile's UV space [0,1]^2 to the correct sub-region
   * of the stitched secondary texture.
   *
   * Usage in shader: `sampledUV = uv * scale + offset`
   */
  uvTransform: [number, number, number, number];

  /**
   * The total stitched texture size in pixels.
   * Width = (maxCol - minCol + 1) * tileWidth
   * Height = (maxRow - minRow + 1) * tileHeight
   */
  stitchedWidth: number;
  stitchedHeight: number;

  /**
   * The min col/row of the secondary tile range (needed for stitching:
   * tells you where each fetched tile goes in the stitched buffer).
   */
  minCol: number;
  minRow: number;
}

/**
 * Resolve which secondary tiles cover a primary tile's extent, and compute
 * the UV transform to map from primary UV space into the stitched secondary
 * texture.
 *
 * @param primaryLevel - The primary tileset level
 * @param primaryCol - Primary tile column index
 * @param primaryRow - Primary tile row index
 * @param secondaryLevel - The secondary tileset level to resolve against
 */
export function resolveSecondaryTiles(
  primaryLevel: TilesetLevel,
  primaryCol: number,
  primaryRow: number,
  secondaryLevel: TilesetLevel,
): SecondaryTileResolution {
  // Step 1: Get the CRS extent of the primary tile
  const corners = primaryLevel.projectedTileCorners(primaryCol, primaryRow);
  const primaryMinX = Math.min(
    corners.topLeft[0],
    corners.bottomLeft[0],
    corners.topRight[0],
    corners.bottomRight[0],
  );
  const primaryMaxX = Math.max(
    corners.topLeft[0],
    corners.bottomLeft[0],
    corners.topRight[0],
    corners.bottomRight[0],
  );
  const primaryMinY = Math.min(
    corners.topLeft[1],
    corners.bottomLeft[1],
    corners.topRight[1],
    corners.bottomRight[1],
  );
  const primaryMaxY = Math.max(
    corners.topLeft[1],
    corners.bottomLeft[1],
    corners.topRight[1],
    corners.bottomRight[1],
  );

  // Step 2: Find covering secondary tiles
  const range = secondaryLevel.crsBoundsToTileRange(
    primaryMinX,
    primaryMinY,
    primaryMaxX,
    primaryMaxY,
  );

  const tileIndices: SecondaryTileIndex[] = [];
  for (let row = range.minRow; row <= range.maxRow; row++) {
    for (let col = range.minCol; col <= range.maxCol; col++) {
      tileIndices.push({ col, row });
    }
  }

  // Step 3: Compute the CRS extent of the stitched secondary region
  // Get corners of the min and max secondary tiles to find total extent
  const minCorners = secondaryLevel.projectedTileCorners(
    range.minCol,
    range.minRow,
  );
  const maxCorners = secondaryLevel.projectedTileCorners(
    range.maxCol,
    range.maxRow,
  );

  const allCornerPoints = [
    minCorners.topLeft,
    minCorners.topRight,
    minCorners.bottomLeft,
    minCorners.bottomRight,
    maxCorners.topLeft,
    maxCorners.topRight,
    maxCorners.bottomLeft,
    maxCorners.bottomRight,
  ];

  const stitchedMinX = Math.min(...allCornerPoints.map((p) => p[0]));
  const stitchedMaxX = Math.max(...allCornerPoints.map((p) => p[0]));
  const stitchedMinY = Math.min(...allCornerPoints.map((p) => p[1]));
  const stitchedMaxY = Math.max(...allCornerPoints.map((p) => p[1]));

  const stitchedCrsWidth = stitchedMaxX - stitchedMinX;
  const stitchedCrsHeight = stitchedMaxY - stitchedMinY;

  // Step 4: Compute UV transform
  const primaryCrsWidth = primaryMaxX - primaryMinX;
  const primaryCrsHeight = primaryMaxY - primaryMinY;

  const scaleX =
    stitchedCrsWidth > 0 ? primaryCrsWidth / stitchedCrsWidth : 1;
  const scaleY =
    stitchedCrsHeight > 0 ? primaryCrsHeight / stitchedCrsHeight : 1;

  // Offset: how far into the stitched texture the primary tile starts.
  // Note: Y axis is top-down in texture space but may be bottom-up in CRS.
  // We use the top-left convention: offset from stitchedMax (top) going down.
  const offsetX =
    stitchedCrsWidth > 0 ? (primaryMinX - stitchedMinX) / stitchedCrsWidth : 0;
  const offsetY =
    stitchedCrsHeight > 0
      ? (stitchedMaxY - primaryMaxY) / stitchedCrsHeight
      : 0;

  // Step 5: Stitched pixel dimensions
  const numCols = range.maxCol - range.minCol + 1;
  const numRows = range.maxRow - range.minRow + 1;
  const stitchedWidth = numCols * secondaryLevel.tileWidth;
  const stitchedHeight = numRows * secondaryLevel.tileHeight;

  return {
    tileIndices,
    uvTransform: [offsetX, offsetY, scaleX, scaleY],
    stitchedWidth,
    stitchedHeight,
    minCol: range.minCol,
    minRow: range.minRow,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/deck.gl-raster/tests/secondary-tile-resolver.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Add exports**

In `packages/deck.gl-raster/src/raster-tileset/index.ts`, add:

```ts
export type {
  SecondaryTileIndex,
  SecondaryTileResolution,
} from "./secondary-tile-resolver.js";
export { resolveSecondaryTiles } from "./secondary-tile-resolver.js";
```

- [ ] **Step 6: Run full test suite and lint**

Run: `npx vitest run packages/deck.gl-raster/`
Run: `npx biome check packages/deck.gl-raster/src/raster-tileset/secondary-tile-resolver.ts`

- [ ] **Step 7: Commit**

```bash
git add packages/deck.gl-raster/src/raster-tileset/secondary-tile-resolver.ts \
       packages/deck.gl-raster/tests/secondary-tile-resolver.test.ts \
       packages/deck.gl-raster/src/raster-tileset/index.ts
git commit -m "feat: add secondary tile resolver with UV transform computation"
```

---

## Task 3: CompositeBands GPU Module

A shader module that samples N named band textures with UV transforms and outputs a `vec4` color.

**Files:**
- Create: `packages/deck.gl-raster/src/gpu-modules/composite-bands.ts`
- Test: `packages/deck.gl-raster/tests/composite-bands.test.ts`
- Modify: `packages/deck.gl-raster/src/gpu-modules/index.ts`

- [ ] **Step 1: Write tests for CompositeBands module structure**

```ts
// packages/deck.gl-raster/tests/composite-bands.test.ts
import { describe, expect, it } from "vitest";
import { createCompositeBandsModule } from "../src/gpu-modules/composite-bands.js";

describe("createCompositeBandsModule", () => {
  it("creates a shader module with correct uniforms for RGB bands", () => {
    const mod = createCompositeBandsModule({
      r: "red",
      g: "green",
      b: "blue",
    });

    expect(mod.name).toBe("composite-bands");

    // Should declare sampler2D and vec4 uvTransform for each band
    const decl = mod.inject["fs:#decl"] as string;
    expect(decl).toContain("uniform sampler2D band_red;");
    expect(decl).toContain("uniform sampler2D band_green;");
    expect(decl).toContain("uniform sampler2D band_blue;");
    expect(decl).toContain("uniform vec4 uvTransform_red;");
    expect(decl).toContain("uniform vec4 uvTransform_green;");
    expect(decl).toContain("uniform vec4 uvTransform_blue;");

    // Should sample bands and assign to color channels
    const filterColor = mod.inject["fs:DECKGL_FILTER_COLOR"] as string;
    expect(filterColor).toContain("band_red");
    expect(filterColor).toContain("band_green");
    expect(filterColor).toContain("band_blue");
    expect(filterColor).toContain("uvTransform_red");
  });

  it("creates a module with only 2 bands (r and g, no blue)", () => {
    const mod = createCompositeBandsModule({
      r: "nir",
      g: "swir",
    });

    const decl = mod.inject["fs:#decl"] as string;
    expect(decl).toContain("uniform sampler2D band_nir;");
    expect(decl).toContain("uniform sampler2D band_swir;");
    // b channel should default to 0
    const filterColor = mod.inject["fs:DECKGL_FILTER_COLOR"] as string;
    expect(filterColor).toContain("0.0"); // default for missing blue
  });

  it("supports an alpha channel", () => {
    const mod = createCompositeBandsModule({
      r: "red",
      g: "green",
      b: "blue",
      a: "alpha",
    });

    const decl = mod.inject["fs:#decl"] as string;
    expect(decl).toContain("uniform sampler2D band_alpha;");
    expect(decl).toContain("uniform vec4 uvTransform_alpha;");
  });

  it("getUniforms passes through texture and transform props", () => {
    const mod = createCompositeBandsModule({ r: "red", g: "green", b: "blue" });

    const mockTexture = { id: "tex" };
    const uniforms = mod.getUniforms!({
      band_red: mockTexture,
      uvTransform_red: [0, 0, 1, 1],
    } as any);

    expect(uniforms.band_red).toBe(mockTexture);
    expect(uniforms.uvTransform_red).toEqual([0, 0, 1, 1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/deck.gl-raster/tests/composite-bands.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CompositeBands**

```ts
// packages/deck.gl-raster/src/gpu-modules/composite-bands.ts
import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Band mapping: which source band goes to which output channel.
 * At least `r` is required; missing channels default to 0.0 (or 1.0 for alpha).
 */
export interface CompositeBandsMapping {
  r: string;
  g?: string;
  b?: string;
  a?: string;
}

/**
 * Create a shader module that samples named band textures with UV transforms
 * and outputs a vec4 color.
 *
 * Each band gets a `sampler2D band_<name>` and `vec4 uvTransform_<name>`
 * uniform. The UV transform is applied before sampling so that textures at
 * different resolutions are correctly aligned.
 */
export function createCompositeBandsModule(
  mapping: CompositeBandsMapping,
): ShaderModule {
  // Collect unique band names
  const bands = new Set<string>();
  if (mapping.r) bands.add(mapping.r);
  if (mapping.g) bands.add(mapping.g);
  if (mapping.b) bands.add(mapping.b);
  if (mapping.a) bands.add(mapping.a);

  // Generate uniform declarations
  const declarations = [...bands]
    .map(
      (name) =>
        `uniform sampler2D band_${name};\nuniform vec4 uvTransform_${name};`,
    )
    .join("\n");

  const uvHelper = /* glsl */ `
vec2 compositeBands_applyUv(vec2 uv, vec4 transform) {
  return uv * transform.zw + transform.xy;
}`;

  // Generate sampling expressions for each channel
  function sampleExpr(channel: string | undefined): string {
    if (!channel) return "0.0";
    return `texture(band_${channel}, compositeBands_applyUv(geometry.uv, uvTransform_${channel})).r`;
  }

  const alphaExpr = mapping.a ? sampleExpr(mapping.a) : "1.0";

  const filterColor = /* glsl */ `
  color = vec4(
    ${sampleExpr(mapping.r)},
    ${sampleExpr(mapping.g)},
    ${sampleExpr(mapping.b)},
    ${alphaExpr}
  );`;

  return {
    name: "composite-bands",
    inject: {
      "fs:#decl": `${declarations}\n${uvHelper}`,
      "fs:DECKGL_FILTER_COLOR": filterColor,
    },
    getUniforms: (props: Record<string, unknown>) => {
      // Pass through all props — they're keyed by band_<name> and uvTransform_<name>
      const uniforms: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (
          key.startsWith("band_") ||
          key.startsWith("uvTransform_")
        ) {
          uniforms[key] = value;
        }
      }
      return uniforms;
    },
  } as ShaderModule;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/deck.gl-raster/tests/composite-bands.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Add exports**

In `packages/deck.gl-raster/src/gpu-modules/index.ts`, add:

```ts
export { createCompositeBandsModule } from "./composite-bands.js";
export type { CompositeBandsMapping } from "./composite-bands.js";
```

- [ ] **Step 6: Run lint**

Run: `npx biome check packages/deck.gl-raster/src/gpu-modules/composite-bands.ts`

- [ ] **Step 7: Commit**

```bash
git add packages/deck.gl-raster/src/gpu-modules/composite-bands.ts \
       packages/deck.gl-raster/tests/composite-bands.test.ts \
       packages/deck.gl-raster/src/gpu-modules/index.ts
git commit -m "feat: add CompositeBands GPU module for multi-band rendering"
```

---

## Task 4: MultiCOGLayer — Initialization and Tileset Construction

The layer that opens multiple COGs, builds their TilesetDescriptors, and constructs the MultiTilesetDescriptor. This task handles init only — fetching and rendering come in Task 5.

**Files:**
- Create: `packages/deck.gl-geotiff/src/multi-cog-layer.ts`
- Modify: `packages/deck.gl-geotiff/src/index.ts`

- [ ] **Step 1: Implement MultiCOGLayer skeleton with initialization**

Study the existing `COGLayer` at `packages/deck.gl-geotiff/src/cog-layer.ts` for patterns. The `MultiCOGLayer` follows the same structure but opens N COGs.

```ts
// packages/deck.gl-geotiff/src/multi-cog-layer.ts
import {
  CompositeLayer,
  type CompositeLayerProps,
  type UpdateParameters,
} from "@deck.gl/core";
import type { TileLayerProps } from "@deck.gl/geo-layers";
import proj4 from "proj4";
import { parseWkt } from "wkt-parser";

import {
  type Bounds,
  type MultiTilesetDescriptor,
  RasterTileset2D,
  type RasterModule,
  TileMatrixSetAdaptor,
  createMultiTilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import type { Tileset2DProps } from "@deck.gl/geo-layers/dist/tileset-2d/tileset-2d";

import type { GeoTIFF } from "@developmentseed/geotiff";
import { fetchGeoTIFF } from "./geotiff/fetch-geotiff.js";
import {
  type EpsgResolver,
  defaultEpsgResolver,
} from "./geotiff/epsg-resolver.js";
import { generateTileMatrixSet } from "./geotiff/geotiff-tile-matrix-set.js";
import type { TileMatrixSet } from "./geotiff/tile-matrix-set-types.js";
import { makeClampedForwardTo3857 } from "./geotiff/projection-utils.js";
import type { CompositeBandsMapping } from "@developmentseed/deck.gl-raster";
import type { DecoderPool } from "@developmentseed/geotiff";

/** A single source band configuration */
export interface MultiCOGSourceConfig {
  /** URL or ArrayBuffer of the COG */
  url: string | URL | ArrayBuffer;
}

export type MultiCOGLayerProps = CompositeLayerProps &
  Pick<
    TileLayerProps,
    | "debounceTime"
    | "maxCacheSize"
    | "maxCacheByteSize"
    | "maxRequests"
    | "refinementStrategy"
  > & {
    /** Named sources — each key becomes a band name. */
    sources: Record<string, MultiCOGSourceConfig>;

    /** Map source bands to RGB(A) output channels. */
    composite?: CompositeBandsMapping;

    /** Post-processing render pipeline modules. */
    renderPipeline?: RasterModule[];

    /** EPSG code resolver. */
    epsgResolver?: EpsgResolver;

    /** Decoder pool for parallel image chunk decompression. */
    pool?: DecoderPool;

    /** Maximum reprojection error in pixels. */
    maxError?: number;

    /** AbortSignal to cancel loading. */
    signal?: AbortSignal;
  };

interface SourceState {
  geotiff: GeoTIFF;
  tms: TileMatrixSet;
}

const defaultProps = {
  epsgResolver: { type: "accessor", value: defaultEpsgResolver },
  maxError: { type: "number", value: 0.125 },
};

export class MultiCOGLayer extends CompositeLayer<MultiCOGLayerProps> {
  static override layerName = "MultiCOGLayer";
  static override defaultProps = defaultProps;

  declare state: {
    sources: Map<string, SourceState>;
    multiDescriptor: MultiTilesetDescriptor | null;
    forwardTo4326: (x: number, y: number) => [number, number];
    inverseFrom4326: (x: number, y: number) => [number, number];
    forwardTo3857: (x: number, y: number) => [number, number];
    inverseFrom3857: (x: number, y: number) => [number, number];
  };

  override initializeState(): void {
    this.setState({
      sources: new Map(),
      multiDescriptor: null,
    });
  }

  override updateState({ changeFlags }: UpdateParameters<this>): void {
    if (changeFlags.dataChanged || changeFlags.propsChanged) {
      this._parseAllSources();
    }
  }

  async _parseAllSources(): Promise<void> {
    const { sources: sourceConfigs } = this.props;
    const entries = Object.entries(sourceConfigs);

    // Open all COGs in parallel
    const results = await Promise.all(
      entries.map(async ([name, config]) => {
        const geotiff = await fetchGeoTIFF(config.url);
        const crs = geotiff.crs;
        const sourceProjection =
          typeof crs === "number"
            ? await this.props.epsgResolver!(crs)
            : parseWkt(crs);

        const tms = generateTileMatrixSet(geotiff, sourceProjection);
        return { name, geotiff, tms, sourceProjection };
      }),
    );

    // Use the first source's projection for shared projection functions
    // (all sources must share the same CRS)
    const firstResult = results[0]!;
    const sourceProjection = firstResult.sourceProjection;

    // @ts-expect-error - proj4 typings are incomplete
    const converter4326 = proj4(sourceProjection, "EPSG:4326");
    const forwardTo4326 = (x: number, y: number) =>
      converter4326.forward<[number, number]>([x, y], false);
    const inverseFrom4326 = (x: number, y: number) =>
      converter4326.inverse<[number, number]>([x, y], false);

    // @ts-expect-error - proj4 typings are incomplete
    const converter3857 = proj4(sourceProjection, "EPSG:3857");
    const forwardTo3857 = makeClampedForwardTo3857(
      (x: number, y: number) =>
        converter3857.forward<[number, number]>([x, y], false),
      forwardTo4326,
    );
    const inverseFrom3857 = (x: number, y: number) =>
      converter3857.inverse<[number, number]>([x, y], false);

    // Build TilesetDescriptors
    const tilesetMap = new Map<string, import("@developmentseed/deck.gl-raster").TilesetDescriptor>();
    const sourceMap = new Map<string, SourceState>();

    for (const result of results) {
      const descriptor = new TileMatrixSetAdaptor(result.tms, {
        projectTo4326: forwardTo4326,
        projectTo3857: forwardTo3857,
      });
      tilesetMap.set(result.name, descriptor);
      sourceMap.set(result.name, {
        geotiff: result.geotiff,
        tms: result.tms,
      });
    }

    const multiDescriptor = createMultiTilesetDescriptor(tilesetMap);

    this.setState({
      sources: sourceMap,
      multiDescriptor,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
    });
  }

  override renderLayers() {
    // Implemented in Task 5
    if (!this.state.multiDescriptor) return null;
    return [];
  }
}
```

- [ ] **Step 2: Add export to index.ts**

In `packages/deck.gl-geotiff/src/index.ts`, add:

```ts
export type { MultiCOGLayerProps, MultiCOGSourceConfig } from "./multi-cog-layer.js";
export { MultiCOGLayer } from "./multi-cog-layer.js";
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p packages/deck.gl-geotiff/tsconfig.json`
Expected: No new errors (pre-existing errors in cog-layer.ts / cog-tile-matrix-set.ts are expected)

- [ ] **Step 4: Run lint**

Run: `npx biome check packages/deck.gl-geotiff/src/multi-cog-layer.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/deck.gl-geotiff/src/multi-cog-layer.ts \
       packages/deck.gl-geotiff/src/index.ts
git commit -m "feat: add MultiCOGLayer skeleton with multi-source initialization"
```

---

## Task 5: MultiCOGLayer — Tile Fetching, Stitching, and Rendering

Wire up `getTileData` (fetch primary + secondary tiles, stitch, compute UV transforms) and `renderLayers` (create TileLayer with RasterLayer sub-layers).

**Files:**
- Modify: `packages/deck.gl-geotiff/src/multi-cog-layer.ts`

- [ ] **Step 1: Add tile fetch imports and helper types**

At the top of `multi-cog-layer.ts`, add the needed imports:

```ts
import { TileLayer } from "@deck.gl/geo-layers";
import type { TileLoadProps } from "@deck.gl/geo-layers";
import {
  RasterLayer,
  resolveSecondaryTiles,
  selectSecondaryLevel,
  tilesetLevelsEqual,
  createCompositeBandsModule,
} from "@developmentseed/deck.gl-raster";
import { fromAffine, tileTransform } from "./geotiff/geotiff-reprojection.js";
import type { Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";
```

Add the tile data type inside the file:

```ts
interface BandTileData {
  texture: Texture;
  uvTransform: [number, number, number, number];
  width: number;
  height: number;
}

interface MultiTileResult {
  bands: Map<string, BandTileData>;
  /** Reprojection fns for the primary tile (for mesh generation) */
  forwardTransform: (x: number, y: number) => [number, number];
  inverseTransform: (x: number, y: number) => [number, number];
}
```

- [ ] **Step 2: Implement _getTileData method**

Add this method to the `MultiCOGLayer` class:

```ts
async _getTileData(tile: TileLoadProps): Promise<MultiTileResult | null> {
  const { multiDescriptor, sources, forwardTo3857, inverseFrom3857 } =
    this.state;
  if (!multiDescriptor) return null;

  const { x, y, z } = tile.index;
  const { signal } = tile;
  const primaryLevel = multiDescriptor.primary.levels[z]!;

  // Compute reprojection fns for the primary tile (for mesh generation)
  const primarySource = sources.get(multiDescriptor.primaryKey)!;
  const primaryTileMatrix = primarySource.tms.tileMatrices[z]!;
  const tileAffine = tileTransform(primaryTileMatrix, { col: x, row: y });
  const { forwardTransform, inverseTransform } = fromAffine(tileAffine);

  const bands = new Map<string, BandTileData>();

  // Fetch all bands in parallel
  const fetchPromises: Promise<void>[] = [];

  for (const [name, sourceState] of sources) {
    const descriptor = multiDescriptor.primaryKey === name
      ? multiDescriptor.primary
      : multiDescriptor.secondaries.get(name);
    if (!descriptor) continue;

    const isPrimary = name === multiDescriptor.primaryKey ||
      tilesetLevelsEqual(descriptor.levels[descriptor.levels.length - 1]!, primaryLevel);

    if (isPrimary) {
      // Same grid as primary — fetch directly with identity UV transform
      fetchPromises.push(
        this._fetchBandTile(sourceState, z, x, y, signal).then((data) => {
          bands.set(name, {
            ...data,
            uvTransform: [0, 0, 1, 1],
          });
        }),
      );
    } else {
      // Different grid — resolve secondary tiles
      const secondaryLevel = selectSecondaryLevel(
        descriptor.levels,
        primaryLevel.metersPerPixel,
      );
      const secondaryZ = descriptor.levels.indexOf(secondaryLevel);
      const resolution = resolveSecondaryTiles(
        primaryLevel,
        x,
        y,
        secondaryLevel,
      );

      fetchPromises.push(
        this._fetchAndStitchSecondary(
          sourceState,
          secondaryZ,
          resolution,
          signal,
        ).then((data) => {
          bands.set(name, {
            ...data,
            uvTransform: resolution.uvTransform,
          });
        }),
      );
    }
  }

  await Promise.all(fetchPromises);

  return { bands, forwardTransform, inverseTransform };
}
```

- [ ] **Step 3: Implement _fetchBandTile and _fetchAndStitchSecondary helper methods**

```ts
/** Fetch a single tile from a COG source and create a GPU texture. */
async _fetchBandTile(
  source: SourceState,
  z: number,
  col: number,
  row: number,
  signal?: AbortSignal,
): Promise<{ texture: Texture; width: number; height: number }> {
  const images = [source.geotiff, ...source.geotiff.overviews];
  const image = images[images.length - 1 - z]!;
  const tileMatrix = source.tms.tileMatrices[z]!;

  const tileData = await (image as Overview).fetchTile(
    col,
    row,
    { signal, pool: this.props.pool },
  );

  const texture = this.context.device.createTexture({
    data: tileData.array.data,
    width: tileData.array.width,
    height: tileData.array.height,
    format: "r8unorm",
  });

  return {
    texture,
    width: tileData.array.width,
    height: tileData.array.height,
  };
}

/**
 * Fetch covering secondary tiles and stitch them into a single texture.
 */
async _fetchAndStitchSecondary(
  source: SourceState,
  z: number,
  resolution: import("@developmentseed/deck.gl-raster").SecondaryTileResolution,
  signal?: AbortSignal,
): Promise<{ texture: Texture; width: number; height: number }> {
  const { tileIndices, stitchedWidth, stitchedHeight, minCol, minRow } =
    resolution;

  if (tileIndices.length === 1) {
    // Single tile — no stitching needed
    const idx = tileIndices[0]!;
    return this._fetchBandTile(source, z, idx.col, idx.row, signal);
  }

  // Fetch all covering tiles in parallel
  const tileResults = await Promise.all(
    tileIndices.map(async (idx) => {
      const result = await this._fetchBandTile(
        source,
        z,
        idx.col,
        idx.row,
        signal,
      );
      return { ...result, col: idx.col, row: idx.row };
    }),
  );

  // Stitch into a single buffer
  const stitched = new Uint8Array(stitchedWidth * stitchedHeight);
  const tileW = tileResults[0]!.width;
  const tileH = tileResults[0]!.height;

  for (const tile of tileResults) {
    const offsetX = (tile.col - minCol) * tileW;
    const offsetY = (tile.row - minRow) * tileH;

    // Read back texture data — this is a simplification.
    // In practice we'd stitch raw buffers before creating textures.
    // For now, copy row by row into the stitched buffer.
    // TODO: Stitch raw pixel buffers before GPU upload for efficiency.
    for (let row = 0; row < tileH; row++) {
      const srcStart = row * tileW;
      const dstStart = (offsetY + row) * stitchedWidth + offsetX;
      // This assumes we have access to the raw data.
      // The actual implementation will need to stitch raw arrays
      // from fetchTile before creating the texture.
    }
  }

  const texture = this.context.device.createTexture({
    data: stitched,
    width: stitchedWidth,
    height: stitchedHeight,
    format: "r8unorm",
  });

  return { texture, width: stitchedWidth, height: stitchedHeight };
}
```

> **Note to implementer:** The stitching in `_fetchAndStitchSecondary` is sketched out above. The actual implementation must stitch raw pixel `Uint8Array` buffers returned by `fetchTile` before creating a single GPU texture. The `fetchTile` API returns `{ array: { data: TypedArray, width, height } }` — use those raw buffers directly. The row-by-row copy loop needs to use the actual source data, not read back from a texture.

- [ ] **Step 4: Implement renderLayers method**

Replace the placeholder `renderLayers` in the class:

```ts
override renderLayers() {
  const { multiDescriptor, forwardTo3857, inverseFrom3857, forwardTo4326 } =
    this.state;
  if (!multiDescriptor) return null;

  const { primaryKey } = multiDescriptor;
  const primarySource = this.state.sources.get(primaryKey)!;
  const tms = primarySource.tms;

  // Build a Tileset2D class that uses the primary descriptor for traversal
  const descriptor = multiDescriptor.primary;
  const forwardTo4326Fn = this.state.forwardTo4326;
  const forwardTo3857Fn = this.state.forwardTo3857;

  class MultiTilesetFactory extends RasterTileset2D {
    constructor(opts: Tileset2DProps) {
      const adapted = new TileMatrixSetAdaptor(tms, {
        projectTo4326: forwardTo4326Fn,
        projectTo3857: forwardTo3857Fn,
      });
      super(opts, adapted, { projectTo4326: forwardTo4326Fn });
    }
  }

  return new TileLayer({
    ...this.props,
    id: `${this.props.id}-tiles`,
    TilesetClass: MultiTilesetFactory as any,
    getTileData: (tile: TileLoadProps) => this._getTileData(tile),
    renderSubLayers: (props: any) => {
      const { data, tile } = props;
      if (!data) return null;

      const { bands, forwardTransform, inverseTransform } =
        data as MultiTileResult;

      const primaryBand = bands.get(primaryKey);
      if (!primaryBand) return null;

      const tileMetadata = tile.metadata as import("@developmentseed/deck.gl-raster").TileMetadata;

      // Build render pipeline
      const pipeline: RasterModule[] = [];

      // If composite mapping is provided, use CompositeBands module
      if (this.props.composite) {
        const compositeMod = createCompositeBandsModule(this.props.composite);

        // Build props for the module: bind textures and UV transforms
        const compositeProps: Record<string, unknown> = {};
        for (const [name, bandData] of bands) {
          compositeProps[`band_${name}`] = bandData.texture;
          compositeProps[`uvTransform_${name}`] = bandData.uvTransform;
        }

        pipeline.push({ module: compositeMod, props: compositeProps });
      }

      // Append user's post-processing pipeline
      if (this.props.renderPipeline) {
        pipeline.push(...this.props.renderPipeline);
      }

      return new RasterLayer({
        id: `${this.props.id}-raster-${tile.index.x}-${tile.index.y}-${tile.index.z}`,
        width: tileMetadata.tileWidth,
        height: tileMetadata.tileHeight,
        reprojectionFns: {
          forwardTransform,
          inverseTransform,
          forwardReproject: forwardTo3857Fn,
          inverseReproject: inverseFrom3857,
        },
        renderPipeline: pipeline,
        maxError: this.props.maxError,
      });
    },
  });
}
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit -p packages/deck.gl-geotiff/tsconfig.json`
Expected: No new errors

- [ ] **Step 6: Run lint**

Run: `npx biome check packages/deck.gl-geotiff/src/multi-cog-layer.ts`

- [ ] **Step 7: Commit**

```bash
git add packages/deck.gl-geotiff/src/multi-cog-layer.ts
git commit -m "feat: add tile fetching, stitching, and rendering to MultiCOGLayer"
```

---

## Task 6: Integration Smoke Test

Create a minimal integration test to verify the full pipeline wires together.

**Files:**
- Create: `packages/deck.gl-geotiff/tests/multi-cog-layer.test.ts`

- [ ] **Step 1: Write integration test**

```ts
// packages/deck.gl-geotiff/tests/multi-cog-layer.test.ts
import { describe, expect, it } from "vitest";
import {
  createMultiTilesetDescriptor,
  selectSecondaryLevel,
  resolveSecondaryTiles,
  tilesetLevelsEqual,
} from "@developmentseed/deck.gl-raster";
import type {
  TilesetDescriptor,
  TilesetLevel,
} from "@developmentseed/deck.gl-raster";
import type { Corners, Point } from "@developmentseed/deck.gl-raster";

/**
 * Simulates a Sentinel-2 scene with 10m and 20m bands.
 * Origin at (600000, 8000000) in EPSG:32625, top-left convention.
 */
function sentinelLevel(cellSize: number, tilePixels: number): TilesetLevel {
  const originX = 600000;
  const originY = 8000000;
  const totalPixels = Math.ceil(109800 / cellSize); // ~110km scene
  const matrixSize = Math.ceil(totalPixels / tilePixels);
  const tileCrsWidth = tilePixels * cellSize;
  const tileCrsHeight = tilePixels * cellSize;

  return {
    matrixWidth: matrixSize,
    matrixHeight: matrixSize,
    tileWidth: tilePixels,
    tileHeight: tilePixels,
    metersPerPixel: cellSize,
    projectedTileCorners: (col: number, row: number): Corners => {
      const minX = originX + col * tileCrsWidth;
      const maxX = minX + tileCrsWidth;
      const maxY = originY - row * tileCrsHeight;
      const minY = maxY - tileCrsHeight;
      return {
        topLeft: [minX, maxY] as Point,
        topRight: [maxX, maxY] as Point,
        bottomLeft: [minX, minY] as Point,
        bottomRight: [maxX, minY] as Point,
      };
    },
    crsBoundsToTileRange: (
      projectedMinX: number,
      projectedMinY: number,
      projectedMaxX: number,
      projectedMaxY: number,
    ) => {
      let minCol = Math.floor((projectedMinX - originX) / tileCrsWidth);
      let maxCol = Math.floor((projectedMaxX - originX) / tileCrsWidth);
      let minRow = Math.floor((originY - projectedMaxY) / tileCrsHeight);
      let maxRow = Math.floor((originY - projectedMinY) / tileCrsHeight);
      minCol = Math.max(0, Math.min(matrixSize - 1, minCol));
      maxCol = Math.max(0, Math.min(matrixSize - 1, maxCol));
      minRow = Math.max(0, Math.min(matrixSize - 1, minRow));
      maxRow = Math.max(0, Math.min(matrixSize - 1, maxRow));
      return { minCol, maxCol, minRow, maxRow };
    },
  };
}

function sentinelDescriptor(cellSize: number): TilesetDescriptor {
  const identity = (x: number, y: number): [number, number] => [x, y];
  // Create a 2-level pyramid: coarse overview + full resolution
  return {
    levels: [
      sentinelLevel(cellSize * 4, 256), // overview
      sentinelLevel(cellSize, 256), // full res
    ],
    projectTo3857: identity,
    projectTo4326: identity,
    projectedBounds: [600000, 7890200, 709800, 8000000],
  };
}

describe("Multi-resolution Sentinel-2 simulation", () => {
  it("builds MultiTilesetDescriptor with 10m as primary", () => {
    const band10m = sentinelDescriptor(10);
    const band20m = sentinelDescriptor(20);

    const multi = createMultiTilesetDescriptor(
      new Map([
        ["B04", band10m],
        ["B11", band20m],
      ]),
    );

    expect(multi.primaryKey).toBe("B04");
    expect(multi.secondaries.has("B11")).toBe(true);
  });

  it("resolves UV transform for 20m band against 10m tile", () => {
    const level10m = sentinelLevel(10, 256); // 256 * 10 = 2560m per tile
    const level20m = sentinelLevel(20, 256); // 256 * 20 = 5120m per tile

    // Primary tile (0,0) covers [600000, 7997440] to [602560, 8000000]
    const result = resolveSecondaryTiles(level10m, 0, 0, level20m);

    // Should map to a sub-region of secondary tile (0,0)
    expect(result.tileIndices.length).toBe(1);
    expect(result.uvTransform[2]).toBeCloseTo(0.5); // scaleX: 2560/5120
    expect(result.uvTransform[3]).toBeCloseTo(0.5); // scaleY: 2560/5120
    expect(result.uvTransform[0]).toBeCloseTo(0); // offsetX: at origin
    expect(result.uvTransform[1]).toBeCloseTo(0); // offsetY: at origin
  });

  it("detects matching grids for same-resolution bands", () => {
    const level10m_a = sentinelLevel(10, 256);
    const level10m_b = sentinelLevel(10, 256);

    expect(tilesetLevelsEqual(level10m_a, level10m_b)).toBe(true);
  });

  it("selectSecondaryLevel picks correct level for zoomed-out view", () => {
    const band20m = sentinelDescriptor(20);
    // When primary is at overview level (~40m), secondary should use overview too
    const selected = selectSecondaryLevel(band20m.levels, 40);
    expect(selected.metersPerPixel).toBe(20);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run packages/deck.gl-geotiff/tests/multi-cog-layer.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: No regressions

- [ ] **Step 4: Commit**

```bash
git add packages/deck.gl-geotiff/tests/multi-cog-layer.test.ts
git commit -m "test: add integration smoke test for multi-resolution tile pipeline"
```
