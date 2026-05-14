# Affine Tileset Design

## Problem

The COG rendering path in `@developmentseed/deck.gl-geotiff` converts every COG into an OGC `TileMatrixSet` (via `generateTileMatrixSet` in [`packages/geotiff/src/tile-matrix-set.ts`](../../packages/geotiff/src/tile-matrix-set.ts)) and then wraps that TMS in a `TileMatrixSetAdaptor` to satisfy `TilesetDescriptor`. TMS is the wrong intermediate abstraction for COGs in two directions:

- **Too narrow** — TMS requires axis-aligned grids and a single scalar `cellSize`. COGs with rotated / skewed geotransforms hit a hard `throw` ([issue #327](https://github.com/developmentseed/deck.gl-raster/issues/327)), and COGs with non-square pixels render incorrectly because the second axis scale is silently dropped ([issue #375](https://github.com/developmentseed/deck.gl-raster/issues/375)).
- **Too broad** — TMS supports variable-size grids within a single resolution level (per-row tile widths, etc.) that no COG or GeoZarr source ever produces.

The `@developmentseed/deck.gl-zarr` package already proves the right shape for the common case: [`ZarrTilesetLevel`](../../packages/deck.gl-zarr/src/zarr-tileset.ts) implements `TilesetLevel` directly from `{ affine, arrayWidth, arrayHeight, tileWidth, tileHeight, mpu }`. This handles rotation, skew, and non-square pixels naturally. The same shape would fix both COG bugs and eliminate ~150 lines of near-duplicate code.

## Goals

- Introduce a generic affine-based `TilesetLevel` / `TilesetDescriptor` pair in `@developmentseed/deck.gl-raster` so that any source describable by `(affine, tile size, array size)` can render without per-source traversal code.
- Migrate the COG layer (`COGLayer`, `MultiCOGLayer`) off the TMS intermediate, fixing issues #327 and #375.
- Migrate the existing inline `ZarrTilesetLevel` to the shared primitive.
- Preserve the public API: `TileMatrixSetAdaptor` stays exported for users who actually feed real OGC TMS data; `generateTileMatrixSet` stays in the source tree (it may be needed again later) but is removed from `packages/geotiff`'s public exports.

## Non-Goals

- Removing or deprecating `TileMatrixSetAdaptor`. It is the right abstraction for true OGC TMS sources and remains exported.
- Deleting `generateTileMatrixSet`. It stays as internal code so it can be revived if a future use case calls for synthesizing a TMS from a COG.
- Supporting non-affine COGs / GeoZarr (GCPs, RPCs). The `TilesetLevel` interface is already polymorphic enough to accept future implementations alongside `AffineTilesetLevel`; no such implementation is part of this work.

## Design

### 1. New primitive: `AffineTilesetLevel`

**Location**: `packages/deck.gl-raster/src/raster-tileset/affine-tileset-level.ts`

A class implementing `TilesetLevel`, parameterized by exactly the state described in the discussion-quote — affine transform plus tile and array size:

```ts
new AffineTilesetLevel({
  affine: Affine,        // pixel → CRS
  arrayWidth: number,    // full level width in pixels
  arrayHeight: number,   // full level height in pixels
  tileWidth: number,
  tileHeight: number,
  mpu: number,           // meters per CRS unit
});
```

All four `TilesetLevel` methods derive from these inputs, lifted from the current `ZarrTilesetLevel` implementation:

- `matrixWidth` / `matrixHeight` = `ceil(arraySize / tileSize)`.
- `metersPerPixel` = `sqrt(|a · e|) · mpu` — geometric mean of the two pixel-edge scales. Handles non-square pixels (#375).
- `projectedTileCorners(col, row)` — four `affine.apply` calls on `(col·tw, row·th)`, `((col+1)·tw, row·th)`, etc. Handles rotation/skew (#327).
- `tileTransform(col, row)` — `compose(affine, translation(col·tw, row·th))` plus its inverse.
- `crsBoundsToTileRange(minX, minY, maxX, maxY)` — inverse-affine the four CRS corners, take pixel-space bbox, divide by tile size, clamp to matrix bounds.

### 2. New primitive: `AffineTileset`

**Location**: `packages/deck.gl-raster/src/raster-tileset/affine-tileset.ts`

A class implementing `TilesetDescriptor`, parameterized by the levels and projection functions:

```ts
new AffineTileset({
  levels: AffineTilesetLevel[],   // coarsest first
  projectTo3857, projectFrom3857,
  projectTo4326, projectFrom4326,
});
```

Two responsibilities on top of the inputs:

1. Expose `levels` and the four projection functions to satisfy `TilesetDescriptor`.
2. Derive `projectedBounds` from the coarsest level's affine applied to its four array corners (`(0,0)`, `(W,0)`, `(0,H)`, `(W,H)`), taking the bbox. This is the same logic currently inlined at the bottom of `geoZarrToDescriptor`.

### 3. COG glue: `geoTiffToDescriptor`

**Location**: `packages/deck.gl-geotiff/src/geotiff-tileset.ts` (new file)

A factory function that builds an `AffineTileset` from a `GeoTIFF`:

```ts
export function geoTiffToDescriptor(
  geotiff: GeoTIFF,
  opts: {
    projectTo3857: ProjectionFunction;
    projectFrom3857: ProjectionFunction;
    projectTo4326: ProjectionFunction;
    projectFrom4326: ProjectionFunction;
    mpu: number;
  },
): AffineTileset;
```

Implementation iterates `[...geotiff.overviews].reverse().concat(geotiff)` (coarsest first, full resolution last — matching the existing `generateTileMatrixSet` ordering), creating one `AffineTilesetLevel` per `Overview` from `overview.transform`, `overview.tileWidth/Height`, `overview.width/height`, and the supplied `mpu`. Returns `new AffineTileset({ levels, ...projections })`.

The `mpu` calculation (`metersPerUnit(crs.units, { semiMajorAxis })`) currently lives inside `generateTileMatrixSet`. It moves to the caller (`cog-layer.ts` / `multi-cog-layer.ts`), which already holds the parsed `sourceProjection` needed to compute it. This mirrors Zarr's existing API where `mpu` is supplied by the caller.

### 4. Zarr migration

`packages/deck.gl-zarr/src/zarr-tileset.ts` deletes its inline `ZarrTilesetLevel` class and the inline `projectedBounds` derivation. `geoZarrToDescriptor` becomes a thin glue function with the same shape as `geoTiffToDescriptor`: build `AffineTilesetLevel`s from `meta.levels` + `chunkSizes`, return an `AffineTileset`.

### 5. COG layer migration

`packages/deck.gl-geotiff/src/cog-layer.ts` and `packages/deck.gl-geotiff/src/multi-cog-layer.ts` replace `generateTileMatrixSet(...)` + `new TileMatrixSetAdaptor(tms, ...)` with a single `geoTiffToDescriptor(geotiff, { ...projections, mpu })` call.

`MultiCOGLayer`'s internal `SourceState` interface drops its `tms: TileMatrixSet` field (it's not exported, so this is a non-breaking change).

### 6. Public API changes

| Package | Change |
|---|---|
| `packages/geotiff/src/index.ts` | Remove `export { generateTileMatrixSet }`. The function and its file remain in the source tree. |
| `packages/deck.gl-raster/src/raster-tileset/index.ts` | Add `export { AffineTilesetLevel, AffineTileset }`. `TileMatrixSetAdaptor` stays exported. |
| `packages/deck.gl-geotiff/src/index.ts` | Add `export { geoTiffToDescriptor }`. |
| `packages/deck.gl-zarr/src/index.ts` | Unchanged — `geoZarrToDescriptor` keeps its current export. |

`packages/geotiff` retains its `morecantile` dependency since `generateTileMatrixSet` and its tests stay in the tree.

### 7. Tests

- New `packages/deck.gl-raster/tests/affine-tileset-level.test.ts` covering: axis-aligned square pixels (regression), non-square pixels (#375), rotated affines (#327), `crsBoundsToTileRange` clamping at matrix edges, `tileTransform` round-trip, `metersPerPixel` for non-square pixels.
- New `packages/deck.gl-raster/tests/affine-tileset.test.ts` covering: `projectedBounds` derived from coarsest level for axis-aligned and rotated affines; passthrough of projection functions and levels.
- New `packages/deck.gl-geotiff/tests/geotiff-tileset.test.ts` covering: descriptor built from a real (or mocked) `GeoTIFF` matches expected level count and ordering (coarsest first).
- Existing `packages/geotiff/tests/tile-matrix-set.test.ts` stays — `generateTileMatrixSet` is still in the source.
- Existing `packages/deck.gl-raster/tests/tileset-refinement.test.ts` and other traversal tests stay — they exercise `TilesetDescriptor`, which doesn't change.

## Acceptance criteria

- A COG with non-square pixels (the dataset attached to issue #375) renders correctly through `COGLayer`.
- A COG with a rotated geotransform (e.g., the Umbra SAR sample referenced in issue #327) renders without throwing.
- All existing tests in `packages/deck.gl-raster`, `packages/deck.gl-geotiff`, `packages/deck.gl-zarr`, and `packages/geotiff` pass.
- `packages/geotiff` does not export `generateTileMatrixSet` from its `index.ts`.
- `packages/deck.gl-zarr/src/zarr-tileset.ts` no longer contains a class that re-implements `TilesetLevel`.
