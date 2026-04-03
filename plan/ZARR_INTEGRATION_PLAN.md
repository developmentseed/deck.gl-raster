# Plan: Zarr/GeoZarr Integration for deck.gl-raster

_Written: 2026-04-03_

## Context

Add Zarr v3 / GeoZarr (zarr-conventions) visualization support to the deck.gl-raster monorepo. The new `ZarrLayer` lets users point at a GeoZarr store and get the same tiled, reprojected, GPU-rendered visualization as `COGLayer` — driven by Zarr multiscales instead of GeoTIFF overviews.

Key decisions:
- **Zarr-conventions only** for now (`spatial` and `geo-proj` required; `multiscales` optional — single-resolution Zarr is valid too)
- **Separate metadata parsing package** (name TBD, tentatively `@developmentseed/geozarr-metadata`) — pure JS object parsing; zarrita is an optional dependency
- **Do NOT force Zarr into TileMatrixSet** — Zarr allows rotated affines; TMS doesn't. Introduce a generic tileset interface that both can implement
- **Each stage is a separate PR**

---

## Stage 0 — Generic Tileset Interface & Refactor in `deck.gl-raster`

This stage refactors the tile traversal to use an abstract interface, enabling any grid-like tileset (TMS or Zarr or custom) to drive the same traversal algorithm. The public API of `TileMatrixSetTileset` is unchanged.

### Core abstractions

**New file: `packages/deck.gl-raster/src/raster-tileset/tileset-interface.ts`**

```typescript
import type { Bounds } from "./types.js";
import type { ProjectionFunction } from "./types.js";

/**
 * A single zoom level in a raster tileset.
 *
 * This is the abstract interface that both TileMatrixSet levels and Zarr
 * multiscale levels implement.
 */
export interface TilesetLevel {
  /** Number of tiles across this level (columns) */
  matrixWidth: number;
  /** Number of tiles down this level (rows) */
  matrixHeight: number;
  /** Width of each tile in pixels */
  tileWidth: number;
  /** Height of each tile in pixels */
  tileHeight: number;
  /**
   * Meters per pixel — used for LOD selection.
   * Equivalent to `scaleDenominator * SCREEN_PIXEL_SIZE` for TileMatrix.
   * For Zarr: approximately sqrt(|scaleX * scaleY|) * mpu (meters per CRS unit).
   * The sqrt handles the case where x and y pixel sizes differ.
   */
  metersPerPixel: number;
  /**
   * Get the bounding box of a tile in the source CRS.
   *
   * Returning a function (not a stored affine) allows both TMS and Zarr to
   * implement this: TMS delegates to xy_bounds(); Zarr uses affine math.
   * This abstraction handles variable tile widths (TMS coalescing) cleanly.
   */
  projectedTileBounds: (col: number, row: number) => Bounds; // [minX, minY, maxX, maxY]
  /**
   * Get the range of tile indices that overlap a given CRS bounding box.
   * Used by the traversal algorithm to find child tiles.
   */
  crsBoundsToTileRange: (
    pMinX: number, pMinY: number, pMaxX: number, pMaxY: number
  ) => { minCol: number; maxCol: number; minRow: number; maxRow: number };
}

/**
 * A full multi-resolution raster tileset.
 *
 * Index 0 = coarsest level, higher = finer detail (same as TileMatrixSet ordering).
 */
export interface TilesetDescriptor {
  /** Ordered levels from coarsest (0) to finest */
  levels: TilesetLevel[];
  /**
   * Projection functions from the source CRS to EPSG:3857 and EPSG:4326.
   * These live here (not in TilesetLevel) because they are shared across all
   * levels and deck.gl-raster must not depend on proj4 directly.
   */
  projectTo3857: ProjectionFunction;
  projectTo4326: ProjectionFunction;
  /** Bounding box of the dataset in source CRS */
  sourceCrsBounds: Bounds;
}
```

Note: `deck.gl-raster` does not depend on proj4. Projection functions are always provided by the caller (COGLayer, ZarrLayer, etc.) and injected via `TilesetDescriptor`.

### Refactor `raster-tile-traversal.ts`

- Change `getTileIndices` signature: `tms: TileMatrixSet, opts: {..., projectTo3857, projectTo4326}` → `descriptor: TilesetDescriptor, opts: {viewport, maxZ, zRange}`
- `RasterTileNode` holds a `TilesetDescriptor` instead of `TileMatrixSet`
- Replace calls to `xy_bounds(tileMatrix, {col, row})` with `level.projectedTileBounds(col, row)`
- Replace `tileMatrix.scaleDenominator * SCREEN_PIXEL_SIZE` with `level.metersPerPixel`
- Rewrite `getOverlappingChildRange` to use `childLevel.crsBoundsToTileRange`

**TilesetLevel for TileMatrixSet:**

Add function `tileMatrixToLevel(matrix: TileMatrix): TilesetLevel` in `raster-tileset-2d.ts`:

```typescript
function tileMatrixToLevel(matrix: TileMatrix): TilesetLevel {
  return {
    matrixWidth: matrix.matrixWidth,
    matrixHeight: matrix.matrixHeight,
    tileWidth: matrix.tileWidth,
    tileHeight: matrix.tileHeight,
    metersPerPixel: matrix.scaleDenominator * SCREEN_PIXEL_SIZE,
    projectedTileBounds: (col, row) => {
      const bounds = xy_bounds(matrix, { col, row });
      return [
        bounds.lowerLeft[0], bounds.lowerLeft[1],
        bounds.upperRight[0], bounds.upperRight[1],
      ];
    },
    crsBoundsToTileRange: (pMinX, pMinY, pMaxX, pMaxY) => {
      // existing getOverlappingChildRange logic using cellSize + pointOfOrigin
    },
  };
}
```

This preserves TMS's support for variable tile widths (coalesced rows) and bottomLeft origins, since those are handled inside `xy_bounds()`.

**New generic tileset class** (name TBD — not "raster", not "descriptor", since it's fully generic):

New file `packages/deck.gl-raster/src/raster-tileset/generic-tileset-2d.ts`. A `Tileset2D` subclass that accepts `TilesetDescriptor` directly. `TileMatrixSetTileset` becomes a thin adapter:

```typescript
export class TileMatrixSetTileset extends Tileset2D {
  constructor(opts, tms: TileMatrixSet, { projectTo4326, projectTo3857 }) {
    const descriptor = tileMatrixSetToDescriptor(tms, projectTo4326, projectTo3857);
    // delegate to GenericTileset2D behavior
  }
}
```

**Exports to add from `packages/deck.gl-raster/src/index.ts`:**
- `TilesetLevel`, `TilesetDescriptor` (types)
- The new generic tileset class (for use by `ZarrLayer`)

**Files to modify in Stage 0:**
- `packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts` — core refactor
- `packages/deck.gl-raster/src/raster-tileset/raster-tileset-2d.ts` — add TMS adapter
- `packages/deck.gl-raster/src/index.ts` — add exports
- `packages/deck.gl-raster/tests/` — update traversal tests to use new interface

**Success criteria for Stage 0 PR:**
- All existing COGLayer tests pass unchanged
- New `TilesetDescriptor`/`TilesetLevel` types exported
- `getTileIndices` takes `TilesetDescriptor` (breaking internal API, not public)

---

## Stage 1 — Zarr Metadata Parsing Package

Pure metadata parsing library. No deck.gl dependency. Takes plain JS objects (the parsed `group.attrs` from zarrita). Zarrita is an optional dependency only if convenience helpers are added.

**Package name:** TBD (tentatively `@developmentseed/geozarr-metadata`)

**Conventions supported:** `spatial` (required), `geo-proj` (required), `multiscales` (optional — single-resolution Zarr without multiscales is valid)

### Package structure
```
packages/geozarr-metadata/
  package.json         — @developmentseed/affine dep; zarrita optional
  tsconfig.json
  tsconfig.build.json  — follow packages/affine/ pattern
  src/
    index.ts
    types.ts
    parse.ts
  tests/
    parse.test.ts      — pure unit tests with static JSON fixtures
```

### `src/types.ts`
```typescript
import type { Affine } from "@developmentseed/affine";

export interface MultiscaleLevel {
  path: string;        // e.g. "0", "1", "2"
  affine: Affine;      // pixel (col, row) → source CRS; built from coordinateTransformations
  arrayWidth: number;  // caller provides from zarrita array.shape
  arrayHeight: number;
}

export interface CRSInfo {
  epsg?: number;
  wkt2?: string;
  proj4String?: string;
}

export interface GeoZarrMetadata {
  /** Ordered levels finest-first (Zarr natural order). Length 1 for single-resolution. */
  levels: MultiscaleLevel[];
  crs: CRSInfo;
  axes: string[];              // from "spatial" convention, e.g. ["y", "x"]
  yAxisIndex: number;
  xAxisIndex: number;
}
```

### `src/parse.ts`
```typescript
/**
 * Parse zarr-conventions metadata from group attributes.
 *
 * Supports single-resolution Zarr (no multiscales) and multi-resolution.
 * The caller is responsible for fetching array shapes (zarrita array.shape)
 * and passing them in as arraySizes, since shape is not in the attributes.
 */
export function parseGeoZarrMetadata(
  attrs: unknown,
  arraySizes: Array<{ width: number; height: number }>,
): GeoZarrMetadata
```

Parsing logic:
1. Parse `attrs["spatial"]` → axis names and x/y indices (required)
2. Parse `attrs["geo-proj"]` → `CRSInfo` (required)
3. If `attrs["multiscales"]` present: parse datasets array, extract `coordinateTransformations` per level, build `Affine`:
   - `scale` → `[scaleX, scaleY]` (scaleY negative for north-up)
   - `translation` → `[tx, ty]`
   - Combined: `[scaleX, 0, tx, 0, scaleY, ty]`
4. If no multiscales: treat as single level (caller provides the one array size)

Add to root `tsconfig.json` project references.

**Success criteria for Stage 1 PR:**
- `parseGeoZarrMetadata` unit tests pass with static JSON fixtures
- Single-resolution and multi-resolution cases both tested
- Package builds cleanly with no deck.gl dependencies

---

## Stage 2 — `ZarrTileset` Adapter

Converts `GeoZarrMetadata` + projection functions into a `TilesetDescriptor`.

**File:** `packages/deck.gl-zarr/src/zarr-tileset.ts`

```typescript
export function geoZarrToDescriptor(
  meta: GeoZarrMetadata,
  projectTo4326: ProjectionFunction,
  projectTo3857: ProjectionFunction,
  chunkSizes: Array<{ width: number; height: number }>,
  mpu: number,   // meters per CRS unit (caller computes from resolved CRS)
): TilesetDescriptor
```

Key implementation notes:
- **Level ordering**: `GeoZarrMetadata.levels` is finest-first; `TilesetDescriptor.levels` requires coarsest-first. Reverse the array.
- **`metersPerPixel`**: `Math.sqrt(Math.abs(affine[0] * affine[4])) * mpu` — geometric mean handles non-square pixels
- **`projectedTileBounds`**: apply the level's affine to all 4 tile pixel corners and take the AABB:
  ```
  corners = [(col*tw, row*th), ((col+1)*tw, row*th), (col*tw, (row+1)*th), ((col+1)*tw, (row+1)*th)]
  crsPts = corners.map(([px, py]) => affine.apply(level.affine, px, py))
  return [min(x), min(y), max(x), max(y)]
  ```
- **`crsBoundsToTileRange`**: `invAffine = affine.invert(level.affine)`, apply to bounding box corners to get pixel coords, divide by tileWidth/tileHeight, floor/clamp
- **`tileWidth/tileHeight`**: from `chunkSizes[i]` (caller reads from `zarrita array.chunks`)
- **`matrixWidth`** = `Math.ceil(level.arrayWidth / tileWidth)`, same for height
- **`sourceCrsBounds`**: apply coarsest level affine to array corners `(0,0)` and `(arrayWidth, arrayHeight)`, take AABB

**Note**: `mpu` is computed by ZarrLayer from the resolved CRS — same `metersPerUnit()` call as in `geotiff/tile-matrix-set.ts`.

---

## Stage 3 — `ZarrLayer`

**File:** `packages/deck.gl-zarr/src/zarr-layer.ts`

Modeled closely on `COGLayer`.

### Props
```typescript
export type ZarrLayerProps = CompositeLayerProps & {
  source: string | URL;                        // Zarr v3 store URL
  variable?: string;                           // optional: variable path within store
  dimensionIndices?: Record<string, number>;   // e.g. { time: 0, band: 2 }
  epsgResolver?: EpsgResolver;                 // same default as COGLayer
  maxError?: number;                           // mesh refinement (default 0.125)
  debug?: boolean;
  debugOpacity?: number;
  onZarrLoad?: (meta: GeoZarrMetadata) => void;
  signal?: AbortSignal;
  // TileLayer pass-throughs:
  debounceTime?: number;
  maxCacheSize?: number;
  maxCacheByteSize?: number;
  maxRequests?: number;
  refinementStrategy?: RefinementStrategy;
}
```

### Lifecycle

**`updateState`**: detect `source` change → clear state → call `_parseZarr()` async

**`_parseZarr()`:**
1. `zarr.open(new zarr.FetchStore(source), {kind: "group"})` via zarrita
2. Open each level array from metadata to get `.shape` (`arraySizes`) and `.chunks` (`chunkSizes`)
3. Call `parseGeoZarrMetadata(group.attrs, arraySizes)`
4. Resolve CRS (same logic as COGLayer):
   - EPSG → `epsgResolver(code)` → `wktParser` → proj4 def
   - WKT2 → `wktParser` directly
   - proj4 string → use directly
5. Build `projectTo4326`, `projectTo3857` via proj4
6. Compute `mpu` via `metersPerUnit(crs.units, {semiMajorAxis})`
7. `geoZarrToDescriptor(meta, projectTo4326, projectTo3857, chunkSizes, mpu)` → `TilesetDescriptor`
8. Store in state: `{ meta, descriptor, group, projectTo4326, projectTo3857 }`

**`renderLayers()`:**
- `TileLayer` with the generic tileset class from Stage 0
- `renderSubLayers` follows COGLayer: `RasterLayer` with reprojection functions

**`_getTileData(tile)`:**
```typescript
// Map descriptor z (0=coarsest) → Zarr level index (finest-first, reversed)
const zarrLevelIdx = meta.levels.length - 1 - tile.index.z;
const level = meta.levels[zarrLevelIdx];

const array = await zarr.open(group.resolve(level.path), { kind: "array" });

// Build slice spec:
// - y-dim: slice(row * tileHeight, min((row+1)*tileHeight, arrayHeight))
// - x-dim: slice(col * tileWidth,  min((col+1)*tileWidth,  arrayWidth))
// - other dims: dimensionIndices[dimName] ?? 0

const result = await zarr.get(array, slices);

// Compute per-tile affine from level affine + tile pixel offset
// tileAffine = affine.compose(level.affine, affine.translation(col*tw, row*th))
const { forwardTransform, inverseTransform } = fromAffine(tileAffine);

// Upload to GPU texture
return { data, texture, width: actualWidth, height: actualHeight,
         forwardTransform, inverseTransform };
```

### Additional files in `deck.gl-zarr`:
- `zarr-proj.ts` — registers EPSG:3857 with proj4 (same pattern as `deck.gl-geotiff/src/proj.ts`)
- `index.ts` — export `ZarrLayer`, `ZarrLayerProps`, re-export key types from metadata package

### `package.json` additions for `deck.gl-zarr`:
- `"@developmentseed/geozarr-metadata": "workspace:^"` (new dep)
- `"wkt-parser": "^1.5.3"` (for WKT2 CRS parsing)
- Peer deps: `@deck.gl/core`, `@deck.gl/geo-layers`, `@luma.gl/core`

---

## Dependency Graph

```
affine
  └── geozarr-metadata  (new — no I/O, no deck.gl; zarrita optional)
  └── morecantile
        └── deck.gl-raster  (stage 0: generic TilesetDescriptor interface)
              └── deck.gl-geotiff  (unchanged public API)
              └── deck.gl-zarr  (stages 2+3: ZarrLayer)
                    └── geozarr-metadata
                    └── zarrita  (already in deps)
```

---

## Implementation Order (one PR per stage)

| Stage | PR contents | Success criteria |
|-------|-------------|-----------------|
| 0 | Generic `TilesetDescriptor`/`TilesetLevel` interface + refactor traversal + TMS adapter + new generic tileset class | All existing COGLayer tests pass; new types exported |
| 1 | New `geozarr-metadata` package with `parseGeoZarrMetadata` | Unit tests pass with fixture JSON; single- and multi-resolution cases covered |
| 2 | `zarr-tileset.ts` adapter (`GeoZarrMetadata` → `TilesetDescriptor`) | Unit tests for level ordering, matrix size math, affine bounds |
| 3 | `ZarrLayer` end-to-end | Renders a real zarr-conventions dataset (e.g., USGS CONUS DEM) correctly |

---

## Open Questions / Future Work

- **Package name**: `geozarr-metadata` is tentative
- **Generic tileset class name**: not "raster", not "descriptor" — TBD
- **Non-square pixels**: `sqrt(|scaleX * scaleY|) * mpu` handles this approximately; could track x and y separately in the future
- **Zarr v2 support**: out of scope for now; zarrita supports both
- **OME-NGFF / ndpyramid support**: future stages once zarr-conventions is solid
